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

        // 1. Fetch Orders (Loja)
        const orders = await prisma.order.findMany({
            where: {
                tenantId,
                status: { in: ['PAID', 'DELIVERED'] }
            },
            select: { total: true, createdAt: true }
        });

        // 2. Fetch Donations
        const donations = await prisma.donation.findMany({
            where: {
                tenantId,
                status: 'COMPLETED'
            },
            select: { amount: true, createdAt: true }
        });

        // 3. Fetch Paid Tickets (Registrations)
        const tickets = await prisma.registration.findMany({
            where: {
                event: { tenantId },
                status: { in: ['CONFIRMED', 'CHECKED_IN'] },
                pricePaid: { gt: 0 }
            },
            select: { pricePaid: true, checkInDate: true, status: true } // Let's use checkInDate or assume recent if needed, but we don't have createdAt on registration. Wait, does Registration have createdAt? No. We might need to estimate or use event date. Let's just aggregate total for now.
        });

        // Aggregate Totals
        const totalShop = orders.reduce((sum, order) => sum + Number(order.total), 0);
        const totalDonations = donations.reduce((sum, don) => sum + Number(don.amount), 0);
        const totalTickets = tickets.reduce((sum, tkt) => sum + Number(tkt.pricePaid), 0);

        const grossTotal = totalShop + totalDonations + totalTickets;
        const platformFee = grossTotal * 0.05; // 5% fee
        const netTotal = grossTotal - platformFee;

        // Format for charts (Source Distribution)
        const distribution = [
            { name: 'Loja', value: totalShop },
            { name: 'Doações', value: totalDonations },
            { name: 'Ingressos', value: totalTickets }
        ].filter(item => item.value > 0);

        // We can add a simple daily breakdown for Shop and Donations (since Registration lacks createdAt)
        // For a true enterprise app, Registration needs createdAt, but let's work with what we have.
        // Let's create a 7-day breakdown for Shop and Donations.
        const last7Days = Array.from({ length: 7 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - i);
            return d.toISOString().split('T')[0];
        }).reverse();

        const dailyRevenue = last7Days.map(dateStr => {
            const dayOrders = orders.filter(o => o.createdAt.toISOString().startsWith(dateStr));
            const dayDonations = donations.filter(d => d.createdAt.toISOString().startsWith(dateStr));

            return {
                date: dateStr,
                loja: dayOrders.reduce((sum, o) => sum + Number(o.total), 0),
                doacoes: dayDonations.reduce((sum, d) => sum + Number(d.amount), 0)
            };
        });

        res.json({
            summary: {
                grossTotal,
                platformFee,
                netTotal,
                totalTransactions: orders.length + donations.length + tickets.length
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
