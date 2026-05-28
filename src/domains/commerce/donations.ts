import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { limiter } from '../../middleware/rateLimiter.js';
import { z } from 'zod';

const router = Router();

const donationSchema = z.object({
    amount: z.number().positive(),
    donorName: z.string().optional(),
    donorEmail: z.string().email().optional(),
    message: z.string().optional(),
    anonymous: z.boolean().default(false),
    tenantId: z.string()
});

// POST /donations - Create a donation with Stripe Checkout
router.post('/', limiter, async (req, res) => {
    try {
        const data = donationSchema.parse(req.body);

        const donation = await prisma.donation.create({
            data: {
                amount: data.amount,
                donorName: data.anonymous ? null : data.donorName,
                donorEmail: data.donorEmail,
                message: data.message,
                anonymous: data.anonymous,
                tenantId: data.tenantId,
                status: 'PENDING'
            }
        });

        // 1. Fetch Tenant to get its stripeConnectId
        const tenant = await prisma.tenant.findUnique({
            where: { id: data.tenantId },
            select: { stripeConnectId: true, name: true }
        });

        // 2. Integration with Stripe
        let stripePaymentData: any = null;
        try {
            const { stripeService } = await import('../../services/stripeService.js');
            
            const amountCents = Math.round(data.amount * 100);
            const platformFeeCents = Math.round(amountCents * 0.05); // 5% fee

            const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

            // Create/Get Customer
            const stripeCustomerId = await stripeService.createCustomer({
                name: data.donorName || 'Doador Anônimo',
                email: data.donorEmail || 'anon@example.com',
                userId: 'guest'
            });

            // Create Split Session (95% Museum, 5% Platform)
            const session = await stripeService.createSplitPaymentSession({
                customerId: stripeCustomerId,
                amount: amountCents,
                description: `Doação para o Museu: ${tenant?.name || 'Cultura'}`,
                connectedAccountId: tenant?.stripeConnectId || '', 
                applicationFeeAmount: platformFeeCents,
                successUrl: `${frontendUrl}/donations/success?id=${donation.id}`,
                cancelUrl: `${frontendUrl}/donations/cancel?id=${donation.id}`
            });

            stripePaymentData = {
                id: session.id,
                checkoutUrl: session.url
            };

            // Update Donation with Stripe ID
            await prisma.donation.update({
                where: { id: donation.id },
                data: {
                    platformFee: data.amount * 0.05,
                    stripePaymentIntentId: session.id
                }
            });

        } catch (err) {
            console.error("Erro na integração Stripe para doação:", err);
            // Non-blocking but return error in payment data
        }

        res.status(201).json({
            donation,
            payment: stripePaymentData ? {
                method: 'STRIPE',
                checkoutUrl: stripePaymentData.checkoutUrl
            } : {
                method: 'STRIPE',
                message: 'Erro ao gerar checkout do Stripe.'
            },
            message: 'Doação registrada. Redirecionando para pagamento.'
        });
    } catch (error) {
        console.error('Error creating donation:', error);
        res.status(500).json({ message: 'Erro ao registrar doação' });
    }
});

// GET /donations/wall - Get donor wall (public donations)
router.get('/wall', async (req, res) => {
    try {
        const { tenantId } = req.query;

        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId é obrigatório' });
        }

        const donations = await prisma.donation.findMany({
            where: {
                tenantId: tenantId as string,
                status: 'COMPLETED'
            },
            select: {
                id: true,
                donorName: true,
                message: true,
                amount: true,
                anonymous: true,
                createdAt: true
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        // Mask anonymous donations
        const publicDonations = donations.map(d => ({
            ...d,
            donorName: d.anonymous ? 'Doador Anônimo' : d.donorName,
            amount: d.anonymous ? null : d.amount 
        }));

        const total = donations.reduce((sum, d) => sum + Number(d.amount), 0);
        const count = donations.length;

        res.json({
            donations: publicDonations,
            stats: {
                totalRaised: total,
                donorCount: count
            }
        });
    } catch (error) {
        console.error('Error fetching donor wall:', error);
        res.status(500).json({ message: 'Erro ao buscar mural de doadores' });
    }
});

// GET /donations/stats - Donation statistics (Admin only)
router.get('/stats', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { tenantId } = req.query;

        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId é obrigatório' });
        }

        const [total, completed, pending] = await Promise.all([
            prisma.donation.aggregate({
                where: { tenantId: tenantId as string, status: 'COMPLETED' },
                _sum: { amount: true },
                _count: true
            }),
            prisma.donation.count({
                where: { tenantId: tenantId as string, status: 'COMPLETED' }
            }),
            prisma.donation.count({
                where: { tenantId: tenantId as string, status: 'PENDING' }
            })
        ]);

        res.json({
            totalRaised: total._sum.amount || 0,
            totalDonations: total._count,
            completedCount: completed,
            pendingCount: pending
        });
    } catch (error) {
        console.error('Error fetching donation stats:', error);
        res.status(500).json({ message: 'Erro ao buscar estatísticas' });
    }
});

export default router;
