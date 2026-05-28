import { Router, Request, Response } from "express";
import PDFDocument from "pdfkit";
import { prisma } from "../../prisma.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// Helper: Format Currency
const currency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

router.get("/financial", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req: Request, res: Response): Promise<any> => {
    try {
        const user = req.user!;
        const { tenantId, startDate, endDate } = req.query;
        const targetTenantId = (user.role === Role.MASTER && tenantId) ? String(tenantId) : user.tenantId;

        if (!targetTenantId) return res.status(400).json({ message: "Tenant obrigatório" });

        // Fetch Real Data
        const startDateObj = startDate ? new Date(String(startDate)) : new Date(new Date().setDate(new Date().getDate() - 30));
        const endDateObj = endDate ? new Date(String(endDate)) : new Date();

        // 1. Tickets (Registrations)
        const ticketSales = await prisma.registration.findMany({
            where: {
                event: { tenantId: targetTenantId },
                status: { in: ['CONFIRMED', 'CHECKED_IN'] },
                createdAt: { gte: startDateObj, lte: endDateObj }
            },
            include: { visitor: true, ticket: true }
        });

        // 2. Shop Orders
        const shopOrders = await prisma.order.findMany({
            where: {
                tenantId: targetTenantId,
                status: { in: ['PAID', 'DELIVERED', 'COMPLETED'] }, // Assuming these statuses exist
                createdAt: { gte: startDateObj, lte: endDateObj }
            },
            include: { visitor: true }
        });

        // 3. Aggregate
        const ticketRevenue = ticketSales.reduce((acc, r) => acc + Number(r.pricePaid), 0);
        const shopRevenue = shopOrders.reduce((acc, o) => acc + Number(o.total), 0);
        const totalRevenue = ticketRevenue + shopRevenue;

        // 4. Transform to Transaction List
        const transactions = [
            ...ticketSales.map(t => ({
                date: t.createdAt.toLocaleDateString('pt-BR'),
                type: `Ingresso: ${t.ticket.name}`,
                amount: Number(t.pricePaid),
                customer: t.guestName || t.visitor?.name || "Visitante"
            })),
            ...shopOrders.map(o => ({
                date: o.createdAt.toLocaleDateString('pt-BR'),
                type: "Loja Virtual",
                amount: Number(o.total),
                customer: o.visitor?.name || "Cliente"
            }))
        ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Recent first

        const data = {
            totalRevenue,
            ticketSales: ticketRevenue,
            shopSales: shopRevenue,
            transactions
        };

        // Create PDF
        const doc = new PDFDocument({ margin: 50 });

        // Set headers for download
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=relatorio_financeiro_${Date.now()}.pdf`);

        doc.pipe(res);

        // Header
        doc.fontSize(20).text("Relatório Financeiro", { align: "center" });
        doc.moveDown();
        doc.fontSize(12).text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, { align: "right" });
        doc.moveDown();

        // Summary
        doc.rect(50, 100, 510, 80).fill("#f5f5f5").stroke();
        doc.fillColor("black");

        doc.text("Receita Total", 70, 120);
        doc.fontSize(18).text(currency(data.totalRevenue), 70, 140);

        doc.fontSize(12).text("Ingressos", 250, 120);
        doc.fontSize(14).text(currency(data.ticketSales), 250, 140);

        doc.fontSize(12).text("Loja", 400, 120);
        doc.fontSize(14).text(currency(data.shopSales), 400, 140);

        doc.moveDown(5);

        // Table Header
        const tableTop = 220;
        doc.font("Helvetica-Bold");
        doc.text("Data", 50, tableTop);
        doc.text("Cliente", 150, tableTop);
        doc.text("Tipo", 350, tableTop);
        doc.text("Valor", 450, tableTop, { align: "right" });
        doc.moveTo(50, tableTop + 15).lineTo(560, tableTop + 15).stroke();

        // Table Rows
        doc.font("Helvetica");
        let y = tableTop + 25;

        data.transactions.forEach((tx) => {
            doc.text(tx.date, 50, y);
            doc.text(tx.customer, 150, y);
            doc.text(tx.type, 350, y);
            doc.text(currency(tx.amount), 450, y, { align: "right" });
            y += 20;
        });

        // Footer
        doc.fontSize(10).text("Museus App - Sistema Enterprise", 50, 700, { align: "center", width: 500 });

        doc.end();

    } catch (err) {
        console.error("Erro gerar PDF", err);
        if (!res.headersSent) res.status(500).json({ message: "Erro ao gerar PDF" });
    }
});

export default router;
