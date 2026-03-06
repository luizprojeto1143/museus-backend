import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// ========== SECRETARY DASHBOARD - Executive View ==========

// Get Dashboard Data for Secretary/City Admin
router.get("/dashboard", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        let tenantId = user.role === Role.MASTER && req.query.tenantId ? (req.query.tenantId as string) : user.tenantId;

        // Fallback for Master users hitting municipal routes with a Museum selected
        if (user.role === Role.MASTER) {
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId || "" } });
            if (!tenant || tenant.type === 'MUSEUM') {
                const cityTenant = await prisma.tenant.findFirst({ where: { type: { in: ['CITY', 'SECRETARIA'] } } });
                if (cityTenant) tenantId = cityTenant.id;
            }
        }

        if (!tenantId) return res.status(400).json({ message: "Tenant obrigatório" });

        // 1. Main Cards
        const [
            totalEquipments,
            totalProjects,
            activeProjects,
            pendingAccessibility,
            totalEvents,
            upcomingEvents
        ] = await Promise.all([
            prisma.tenant.count({ where: { parentId: tenantId } }),
            prisma.culturalProject.count({ where: { tenantId } }),
            prisma.culturalProject.count({
                where: { tenantId, status: { in: ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "IN_EXECUTION"] } }
            }),
            prisma.accessibilityExecution.count({
                where: { tenantId, status: { in: ["PENDING", "IN_PROGRESS"] } }
            }),
            prisma.event.count({ where: { tenantId } }),
            prisma.event.count({
                where: { tenantId, startDate: { gte: new Date() } }
            })
        ]);

        // 2. Accessibility Status by Equipment
        const childTenants = await prisma.tenant.findMany({
            where: { parentId: tenantId },
            select: {
                id: true,
                name: true,
                type: true,
                accessibilityResources: true
            }
        });

        const equipmentAccessibility = await Promise.all(
            childTenants.map(async (child) => {
                const hasAccessibility = child.accessibilityResources !== null;
                const pendingRequests = await prisma.accessibilityExecution.count({
                    where: { tenantId: child.id, status: "PENDING" }
                });
                return {
                    id: child.id,
                    name: child.name,
                    type: child.type,
                    hasAccessibility,
                    pendingRequests
                };
            })
        );

        // 3. Recent Projects (last 5)
        const recentProjects = await prisma.culturalProject.findMany({
            where: { tenantId },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { id: true, title: true, status: true, createdAt: true }
        });

        // 4. Alerts
        const alerts: { type: string; message: string; severity: string }[] = [];

        // Equipment without accessibility
        const noAccessibilityEquipments = equipmentAccessibility.filter(e => !e.hasAccessibility);
        if (noAccessibilityEquipments.length > 0) {
            alerts.push({
                type: "ACCESSIBILITY",
                message: `${noAccessibilityEquipments.length} equipamento(s) sem recursos de acessibilidade cadastrados`,
                severity: "WARNING"
            });
        }

        // Pending accessibility requests
        if (pendingAccessibility > 0) {
            alerts.push({
                type: "ACCESSIBILITY",
                message: `${pendingAccessibility} solicitação(ões) de acessibilidade pendente(s)`,
                severity: "INFO"
            });
        }

        // Projects under review
        const underReview = await prisma.culturalProject.count({
            where: { tenantId, status: "SUBMITTED" }
        });
        if (underReview > 0) {
            alerts.push({
                type: "PROJECTS",
                message: `${underReview} projeto(s) aguardando análise`,
                severity: "INFO"
            });
        }

        return res.json({
            cards: {
                totalEquipments,
                totalProjects,
                activeProjects,
                pendingAccessibility,
                totalEvents,
                upcomingEvents
            },
            equipmentAccessibility,
            recentProjects,
            alerts
        });

    } catch (err) {
        console.error("Error fetching secretary dashboard", err);
        return res.status(500).json({ message: "Erro ao carregar dashboard" });
    }
});

// Get Accessibility Timeline for a specific tenant or project
router.get("/accessibility-timeline", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
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

        const { projectId, childTenantId } = req.query;

        if (!tenantId) return res.status(400).json({ message: "Tenant obrigatório" });

        const where: any = {};

        if (childTenantId) {
            where.tenantId = childTenantId;
        } else if (projectId) {
            where.projectId = projectId;
        } else {
            where.tenantId = tenantId;
        }

        const timeline = await prisma.accessibilityExecution.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: 50,
            include: {
                provider: { select: { id: true, name: true } },
                project: { select: { id: true, title: true } }
            }
        });

        const formattedTimeline = timeline.map(item => ({
            id: item.id,
            date: item.createdAt,
            type: item.serviceType,
            status: item.status,
            requestedAt: item.requestedAt,
            requestedBy: item.requestedBy,
            approvedAt: item.approvedAt,
            approvedBy: item.approvedBy,
            executedAt: item.executedAt,
            provider: item.provider?.name,
            project: item.project?.title,
            delayDays: item.approvedAt && item.executedAt
                ? Math.floor((new Date(item.executedAt).getTime() - new Date(item.approvedAt).getTime()) / (1000 * 60 * 60 * 24))
                : null
        }));

        return res.json(formattedTimeline);

    } catch (err) {
        console.error("Error fetching accessibility timeline", err);
        return res.status(500).json({ message: "Erro ao carregar linha do tempo" });
    }
});

// Legal Compliance Matrix
router.get("/legal-compliance", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
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

        // Get data for evidence
        const [
            totalAccessibility,
            librasCount,
            audioDescCount,
            childTenants
        ] = await Promise.all([
            prisma.accessibilityExecution.count({ where: { tenantId } }),
            prisma.accessibilityExecution.count({ where: { tenantId, serviceType: "LIBRAS_INTERPRETATION" } }),
            prisma.accessibilityExecution.count({ where: { tenantId, serviceType: "AUDIO_DESCRIPTION" } }),
            prisma.tenant.findMany({ where: { parentId: tenantId }, select: { accessibilityResources: true } })
        ]);

        const tenantsWithResources = childTenants.filter(t => t.accessibilityResources !== null).length;

        const complianceMatrix = [
            {
                law: "Lei 13.146/2015 (LBI)",
                requirement: "Acessibilidade comunicacional em bens culturais",
                howWeComply: "Interpretação em Libras e audiodescrição",
                evidence: `${librasCount + audioDescCount} execuções realizadas`,
                compliant: (librasCount + audioDescCount) > 0
            },
            {
                law: "Lei 10.098/2000",
                requirement: "Acessibilidade física em equipamentos culturais",
                howWeComply: "Cadastro de recursos físicos por equipamento",
                evidence: `${tenantsWithResources}/${childTenants.length} equipamentos com recursos cadastrados`,
                compliant: tenantsWithResources > 0
            },
            {
                law: "NBR 9050:2020",
                requirement: "Sinalização tátil e visual",
                howWeComply: "Registro de recursos de sinalização",
                evidence: "Cadastro de recursos por equipamento",
                compliant: tenantsWithResources > 0
            },
            {
                law: "Decreto 5.296/2004",
                requirement: "Prioridade em projetos culturais acessíveis",
                howWeComply: "Plano de acessibilidade obrigatório em editais",
                evidence: `Sistema exige plano de acessibilidade em editais`,
                compliant: true
            },
            {
                law: "Lei 12.527/2011 (LAI)",
                requirement: "Transparência de dados públicos",
                howWeComply: "Portal de transparência e relatórios exportáveis",
                evidence: "Relatórios executivos disponíveis",
                compliant: true
            }
        ];

        return res.json({
            summary: {
                totalLaws: complianceMatrix.length,
                compliant: complianceMatrix.filter(c => c.compliant).length,
                complianceRate: Math.round(complianceMatrix.filter(c => c.compliant).length / complianceMatrix.length * 100)
            },
            matrix: complianceMatrix
        });

    } catch (err) {
        console.error("Error fetching legal compliance", err);
        return res.status(500).json({ message: "Erro ao carregar matriz de conformidade" });
    }
});

export default router;
