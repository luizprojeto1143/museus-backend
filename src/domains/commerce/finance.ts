import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';

const router = Router();

// GET /finance/dashboard - Get financial aggregated data
router.get('/dashboard', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'TenantID obrigatório' });
        }

        // Fetch aggregated stats from FinancialTransaction instead of individual tables
        const [
            shopAgg,
            donationsAgg,
            ticketsAgg,
            serviceAgg,
            totalAgg
        ] = await Promise.all([
            prisma.financialTransaction.aggregate({
                where: { tenantId, status: 'COMPLETED', source: 'ORDER' },
                _sum: { amount: true, fee: true, netAmount: true },
                _count: { id: true }
            }),
            prisma.financialTransaction.aggregate({
                where: { tenantId, status: 'COMPLETED', source: 'DONATION' },
                _sum: { amount: true, fee: true, netAmount: true },
                _count: { id: true }
            }),
            prisma.financialTransaction.aggregate({
                where: { tenantId, status: 'COMPLETED', source: 'REGISTRATION' },
                _sum: { amount: true, fee: true, netAmount: true },
                _count: { id: true }
            }),
            prisma.financialTransaction.aggregate({
                where: { tenantId, status: 'COMPLETED', source: 'SERVICE' },
                _sum: { amount: true, fee: true, netAmount: true },
                _count: { id: true }
            }),
            prisma.financialTransaction.aggregate({
                where: { tenantId, status: 'COMPLETED' },
                _sum: { amount: true, fee: true, netAmount: true },
                _count: { id: true }
            })
        ]);

        const totalShop = Number(shopAgg._sum.amount || 0);
        const totalDonations = Number(donationsAgg._sum.amount || 0);
        const totalTickets = Number(ticketsAgg._sum.amount || 0);
        const totalService = Number(serviceAgg._sum.amount || 0);

        const grossTotal = Number(totalAgg._sum.amount || 0);
        const platformFee = Number(totalAgg._sum.fee || 0);
        const netTotal = Number(totalAgg._sum.netAmount || 0);

        // Format for charts (Source Distribution)
        const distribution = [
            { name: 'Loja', value: totalShop },
            { name: 'Doações', value: totalDonations },
            { name: 'Ingressos', value: totalTickets },
            { name: 'Serviços', value: totalService }
        ].filter(item => item.value > 0);

        // Calculate Daily Breakdown dynamically via database
        const last7Days = Array.from({ length: 7 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - i);
            return d.toISOString().split('T')[0];
        }).reverse();

        // Query daily revenue grouped by date
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const dailyTx = await prisma.financialTransaction.findMany({
            where: { tenantId, status: 'COMPLETED', createdAt: { gte: sevenDaysAgo } },
            select: { amount: true, source: true, createdAt: true }
        });

        const dailyRevenue = last7Days.map(dateStr => {
            const dayTxs = dailyTx.filter(t => t.createdAt.toISOString().startsWith(dateStr));
            return {
                date: dateStr,
                loja: dayTxs.filter(t => t.source === 'ORDER').reduce((sum, t) => sum + Number(t.amount), 0),
                doacoes: dayTxs.filter(t => t.source === 'DONATION').reduce((sum, t) => sum + Number(t.amount), 0),
                ingressos: dayTxs.filter(t => t.source === 'REGISTRATION').reduce((sum, t) => sum + Number(t.amount), 0),
                servicos: dayTxs.filter(t => t.source === 'SERVICE').reduce((sum, t) => sum + Number(t.amount), 0)
            };
        });

        res.json({
            summary: {
                grossTotal,
                platformFee,
                netTotal,
                totalTransactions: totalAgg._count.id
            },
            distribution,
            dailyRevenue
        });

    } catch (error) {
        console.error("Finance Dashboard Error:", error);
        res.status(500).json({ message: 'Erro ao carregar dados financeiros' });
    }
});

export const financeRouter = router;
