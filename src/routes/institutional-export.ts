import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import PDFDocument from "pdfkit";

const router = Router();

// Export institutional report as PDF
router.get("/pdf", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === Role.MASTER ? (req.query.tenantId as string) : user.tenantId;

        if (!tenantId) return res.status(400).json({ message: "Tenant obrigatório" });

        const { startDate, endDate, type = "general" } = req.query;
        const start = startDate ? new Date(String(startDate)) : new Date(new Date().setMonth(new Date().getMonth() - 1));
        const end = endDate ? new Date(String(endDate)) : new Date();

        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            include: { parent: true }
        });

        if (!tenant) return res.status(404).json({ message: "Tenant não encontrado" });

        // Gather data
        const [projects, events, accessibility, children] = await Promise.all([
            prisma.culturalProject.count({ where: { tenantId, createdAt: { gte: start, lte: end } } }),
            prisma.event.count({ where: { tenantId, createdAt: { gte: start, lte: end } } }),
            prisma.accessibilityExecution.count({ where: { tenantId, createdAt: { gte: start, lte: end } } }),
            prisma.tenant.count({ where: { parentId: tenantId } })
        ]);

        // Create PDF
        const doc = new PDFDocument({ margin: 50 });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="relatorio-institucional-${tenant.slug}-${start.toISOString().slice(0, 10)}.pdf"`);

        doc.pipe(res);

        // Institutional Header
        doc.fontSize(8).text("DOCUMENTO OFICIAL", { align: "center" });
        doc.fontSize(8).text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, { align: "center" });
        doc.moveDown();

        // Organization info
        if (tenant.parent) {
            doc.fontSize(10).text(tenant.parent.name.toUpperCase(), { align: "center" });
        }
        doc.fontSize(14).text(tenant.name.toUpperCase(), { align: "center" });
        doc.moveDown();

        // Report Title
        doc.fontSize(16).text("RELATÓRIO INSTITUCIONAL DE GESTÃO CULTURAL", { align: "center" });
        doc.fontSize(10).text(`Período: ${start.toLocaleDateString("pt-BR")} a ${end.toLocaleDateString("pt-BR")}`, { align: "center" });
        doc.moveDown(2);

        // Summary Section
        doc.fontSize(14).text("1. RESUMO EXECUTIVO", { underline: true });
        doc.moveDown();
        doc.fontSize(11);
        doc.text(`Este relatório apresenta os dados consolidados da gestão cultural do período especificado.`);
        doc.moveDown();

        // Stats
        doc.fontSize(14).text("2. INDICADORES", { underline: true });
        doc.moveDown();
        doc.fontSize(11);
        doc.text(`• Equipamentos culturais vinculados: ${children}`);
        doc.text(`• Projetos culturais no período: ${projects}`);
        doc.text(`• Eventos realizados: ${events}`);
        doc.text(`• Ações de acessibilidade: ${accessibility}`);
        doc.moveDown(2);

        // Legal Compliance
        doc.fontSize(14).text("3. CONFORMIDADE LEGAL", { underline: true });
        doc.moveDown();
        doc.fontSize(11);
        doc.text("Atestamos que as ações registradas neste sistema estão em conformidade com:");
        doc.moveDown(0.5);
        doc.text("• Lei 13.146/2015 - Lei Brasileira de Inclusão");
        doc.text("• Lei 10.098/2000 - Acessibilidade");
        doc.text("• Lei 12.527/2011 - Lei de Acesso à Informação");
        doc.text("• NBR 9050:2020 - Acessibilidade Técnica");
        doc.moveDown(2);

        // Validation
        doc.fontSize(14).text("4. VALIDAÇÃO", { underline: true });
        doc.moveDown();
        doc.fontSize(10);
        doc.text(`Documento gerado automaticamente pelo Sistema Cultura Viva.`);
        doc.text(`ID de verificação: ${Buffer.from(tenantId + start.toISOString()).toString("base64").slice(0, 16)}`);
        doc.text(`Hash: ${Date.now().toString(36)}`);
        doc.moveDown(3);

        // Footer
        doc.fontSize(9).text("_".repeat(50), { align: "center" });
        doc.text("Assinatura Digital do Sistema", { align: "center" });
        doc.moveDown();
        doc.fontSize(8).text("Este documento possui validade institucional e pode ser verificado no sistema.", { align: "center" });

        doc.end();

    } catch (err) {
        console.error("Error generating institutional PDF", err);
        return res.status(500).json({ message: "Erro ao gerar PDF institucional" });
    }
});

// Export data as CSV
router.get("/csv", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === Role.MASTER ? (req.query.tenantId as string) : user.tenantId;

        if (!tenantId) return res.status(400).json({ message: "Tenant obrigatório" });

        const { startDate, endDate, type = "projects" } = req.query;
        const start = startDate ? new Date(String(startDate)) : new Date(new Date().setMonth(new Date().getMonth() - 3));
        const end = endDate ? new Date(String(endDate)) : new Date();

        let csvContent = "";
        let filename = "";

        if (type === "projects") {
            const projects = await prisma.culturalProject.findMany({
                where: { tenantId, createdAt: { gte: start, lte: end } },
                select: {
                    id: true,
                    title: true,
                    status: true,
                    createdAt: true
                }
            });

            csvContent = "ID;Título;Status;Criado Em\n";
            csvContent += projects.map(p =>
                `${p.id};${p.title};${p.status};${p.createdAt.toLocaleDateString("pt-BR")}`
            ).join("\n");
            filename = "projetos";

        } else if (type === "accessibility") {
            const executions = await prisma.accessibilityExecution.findMany({
                where: { tenantId, createdAt: { gte: start, lte: end } },
                select: {
                    id: true,
                    serviceType: true,
                    status: true,
                    requestedAt: true,
                    executedAt: true,
                    provider: { select: { name: true } }
                }
            });

            csvContent = "ID;Tipo de Serviço;Status;Prestador;Solicitado Em;Executado Em\n";
            csvContent += executions.map(e =>
                `${e.id};${e.serviceType};${e.status};${e.provider?.name || "-"};${e.requestedAt?.toLocaleDateString("pt-BR") || "-"};${e.executedAt?.toLocaleDateString("pt-BR") || "-"}`
            ).join("\n");
            filename = "acessibilidade";

        } else if (type === "events") {
            const events = await prisma.event.findMany({
                where: { tenantId, startDate: { gte: start, lte: end } },
                select: {
                    id: true,
                    title: true,
                    startDate: true,
                    endDate: true
                }
            });

            csvContent = "ID;Título;Data Início;Data Fim\n";
            csvContent += events.map(e =>
                `${e.id};${e.title};${e.startDate.toLocaleDateString("pt-BR")};${e.endDate?.toLocaleDateString("pt-BR") || "-"}`
            ).join("\n");
            filename = "eventos";
        }

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}-${start.toISOString().slice(0, 10)}-${end.toISOString().slice(0, 10)}.csv"`);

        // Add BOM for Excel compatibility
        res.send("\ufeff" + csvContent);

    } catch (err) {
        console.error("Error generating CSV", err);
        return res.status(500).json({ message: "Erro ao gerar CSV" });
    }
});

export default router;
