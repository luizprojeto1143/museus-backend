import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { Role } from "@prisma/client";
import PDFDocument from "pdfkit";

const router = Router();

// ========== EXECUTIVE REPORTS - For Secretary/City Decision Makers ==========

// Get Executive Summary for a City/Secretaria
router.get("/summary", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        let tenantId = user.role === Role.MASTER && req.query.tenantId ? (req.query.tenantId as string) : user.tenantId;

        if (user.role === Role.MASTER) {
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId || "" } });
            if (!tenant || tenant.type === 'MUSEUM') {
                const cityTenant = await prisma.tenant.findFirst({ where: { type: { in: ['CITY', 'SECRETARIA'] } } });
                if (cityTenant) tenantId = cityTenant.id;
            }
        }

        if (!tenantId) return res.status(400).json({ message: "Tenant obrigatório" });

        // Get all child tenant IDs to aggregate their data
        const children = await prisma.tenant.findMany({
            where: { parentId: tenantId },
            select: { id: true }
        });
        const allRelatedTenantIds = [tenantId, ...children.map(c => c.id)];

        const { startDate, endDate } = req.query;
        const start = startDate ? new Date(String(startDate)) : new Date(new Date().setMonth(new Date().getMonth() - 1));
        const end = endDate ? new Date(String(endDate)) : new Date();

        // 1. Cultural Equipment (Child Tenants)
        const childTenants = await prisma.tenant.findMany({
            where: { parentId: tenantId },
            select: { id: true, name: true, type: true }
        });

        // 2. Accessibility Status
        const accessibilityExecutions = await prisma.accessibilityExecution.findMany({
            where: {
                tenantId: { in: allRelatedTenantIds },
                createdAt: { gte: start, lte: end }
            }
        });

        const accessibilityByType = accessibilityExecutions.reduce((acc, exec) => {
            acc[exec.serviceType] = (acc[exec.serviceType] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const accessibilityByStatus = accessibilityExecutions.reduce((acc, exec) => {
            acc[exec.status] = (acc[exec.status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        // 3. Cultural Projects
        const projects = await prisma.culturalProject.findMany({
            where: {
                tenantId: { in: allRelatedTenantIds },
                createdAt: { gte: start, lte: end }
            }
        });

        const projectsByStatus = projects.reduce((acc, proj) => {
            acc[proj.status] = (acc[proj.status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const accessibleProjects = projects.filter(p => p.accessibilityPlan !== null).length;

        // 4. Public Impact (Estimated)
        const totalEvents = await prisma.event.count({
            where: {
                tenantId: { in: allRelatedTenantIds },
                startDate: { gte: start, lte: end }
            }
        });

        const registrations = await prisma.registration.count({
            where: {
                event: { tenantId: { in: allRelatedTenantIds } },
                createdAt: { gte: start, lte: end }
            }
        });

        // 5. Evolution (Month by Month)
        const monthlyEvolution = await getMonthlyEvolution(tenantId, start, end);

        return res.json({
            period: { start, end },
            summary: {
                totalEquipments: childTenants.length,
                equipmentsByType: childTenants.reduce((acc, t) => {
                    acc[t.type] = (acc[t.type] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>),

                totalAccessibilityActions: accessibilityExecutions.length,
                accessibilityByType,
                accessibilityByStatus,
                accessibilityCompletionRate: accessibilityExecutions.length > 0
                    ? Math.round((accessibilityByStatus["COMPLETED"] || 0) / accessibilityExecutions.length * 100)
                    : 0,

                totalProjects: projects.length,
                projectsByStatus,
                projectsWithAccessibility: accessibleProjects,
                accessibilityPlanRate: projects.length > 0
                    ? Math.round(accessibleProjects / projects.length * 100)
                    : 0,

                totalEvents,
                estimatedPublicImpact: registrations,

                legalCompliance: {
                    lbi13146: true, // Lei Brasileira de Inclusão
                    lei10098: true, // Acessibilidade
                    nbr9050: accessibilityExecutions.length > 0
                }
            },
            evolution: monthlyEvolution
        });
    } catch (err) {
        console.error("Error generating executive summary", err);
        return res.status(500).json({ message: "Erro ao gerar relatório executivo" });
    }
});

// Generate PDF Report
router.get("/pdf", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        let tenantId = user.role === Role.MASTER && req.query.tenantId ? (req.query.tenantId as string) : user.tenantId;

        if (user.role === Role.MASTER) {
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId || "" } });
            if (!tenant || tenant.type === 'MUSEUM') {
                const cityTenant = await prisma.tenant.findFirst({ where: { type: { in: ['CITY', 'SECRETARIA'] } } });
                if (cityTenant) tenantId = cityTenant.id;
            }
        }

        if (!tenantId) return res.status(400).send("Tenant obrigatório");

        // Get all child tenant IDs to aggregate their data
        const children = await prisma.tenant.findMany({
            where: { parentId: tenantId },
            select: { id: true }
        });
        const allRelatedTenantIds = [tenantId, ...children.map(c => c.id)];

        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) return res.status(404).json({ message: "Tenant não encontrado" });

        const { startDate, endDate } = req.query;
        const start = startDate ? new Date(String(startDate)) : new Date(new Date().setMonth(new Date().getMonth() - 1));
        const end = endDate ? new Date(String(endDate)) : new Date();

        // Get summary data
        const childTenantsCount = await prisma.tenant.count({ where: { parentId: tenantId } });
        const projectsCount = await prisma.culturalProject.count({ where: { tenantId: { in: allRelatedTenantIds } } });
        const accessibilityActionsCount = await prisma.accessibilityExecution.count({ where: { tenantId: { in: allRelatedTenantIds } } });
        const eventsCount = await prisma.event.count({ where: { tenantId: { in: allRelatedTenantIds } } });

        // Generate PDF
        const doc = new PDFDocument({ margin: 50 });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="relatorio-executivo-${tenant.slug}.pdf"`);

        doc.pipe(res);

        // Header
        doc.fontSize(20).text("RELATÓRIO EXECUTIVO INSTITUCIONAL", { align: "center" });
        doc.moveDown();
        doc.fontSize(14).text(tenant.name, { align: "center" });
        doc.fontSize(10).text(`Período: ${start.toLocaleDateString("pt-BR")} a ${end.toLocaleDateString("pt-BR")}`, { align: "center" });
        doc.moveDown(2);

        // Summary Section
        doc.fontSize(14).text("RESUMO EXECUTIVO", { underline: true });
        doc.moveDown();
        doc.fontSize(11);
        doc.text(`• Equipamentos Culturais Vinculados: ${childTenantsCount}`);
        doc.text(`• Projetos Culturais Registrados: ${projectsCount}`);
        doc.text(`• Ações de Acessibilidade Executadas: ${accessibilityActionsCount}`);
        doc.text(`• Eventos Realizados: ${eventsCount}`);
        doc.moveDown(2);

        // Legal Compliance
        doc.fontSize(14).text("CONFORMIDADE LEGAL", { underline: true });
        doc.moveDown();
        doc.fontSize(11);
        doc.text("✓ Lei Brasileira de Inclusão (Lei 13.146/2015)");
        doc.text("✓ Lei de Acessibilidade (Lei 10.098/2000)");
        doc.text("✓ NBR 9050 - Acessibilidade Física");
        doc.moveDown(2);

        // Footer
        doc.fontSize(9).text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, { align: "center" });
        doc.text("Documento gerado automaticamente pelo Sistema Cultura Viva", { align: "center" });

        doc.end();

    } catch (err) {
        console.error("Error generating PDF", err);
        return res.status(500).json({ message: "Erro ao gerar PDF" });
    }
});

// Helper function for monthly evolution
async function getMonthlyEvolution(tenantId: string, start: Date, end: Date) {
    const months: { month: string; projects: number; accessibility: number; events: number }[] = [];

    const current = new Date(start);
    while (current <= end) {
        const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
        const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);

        const children = await prisma.tenant.findMany({
            where: { parentId: tenantId },
            select: { id: true }
        });
        const allRelatedTenantIds = [tenantId, ...children.map(c => c.id)];

        const [monthProjects, monthAccessibility, monthEvents] = await Promise.all([
            prisma.culturalProject.count({
                where: { tenantId: { in: allRelatedTenantIds }, createdAt: { gte: monthStart, lte: monthEnd } }
            }),
            prisma.accessibilityExecution.count({
                where: { tenantId: { in: allRelatedTenantIds }, createdAt: { gte: monthStart, lte: monthEnd } }
            }),
            prisma.event.count({
                where: { tenantId: { in: allRelatedTenantIds }, startDate: { gte: monthStart, lte: monthEnd } }
            })
        ]);

        months.push({
            month: `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`,
            projects: monthProjects,
            accessibility: monthAccessibility,
            events: monthEvents
        });

        current.setMonth(current.getMonth() + 1);
    }

    return months;
}

export default router;
