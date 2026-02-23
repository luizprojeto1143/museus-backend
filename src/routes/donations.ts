import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimiter.js';
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

// POST /donations - Create a donation (placeholder for payment integration)
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

        // MOCK PAYMENT MODE - For development without real payment gateway
        // To use real payments, integrate with Asaas, MercadoPago, or Stripe
        // Set PAYMENT_GATEWAY=production in .env to disable mock auto-approval
        const isProduction = process.env.NODE_ENV === 'production';
        // Safety check: Avoid auto-approval in production even if misconfigured
        const isMockMode = process.env.NODE_ENV === 'development' || process.env.ALLOW_MOCK_PAYMENTS === 'true';
        const isStrictProduction = process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_PAYMENTS !== 'true';

        const pixCode = `00020126580014BR.GOV.BCB.PIX0136${process.env.PIX_KEY || '123e4567-e89b-12d3-a456-426614174000'}520400005303986540${data.amount.toFixed(2).replace('.', '')}5802BR5913${process.env.PIX_RECIPIENT || 'Museus System'}6008Brasilia62070503***6304`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pixCode)}`;

        // Auto-approve after 30 seconds (Simulation for Demo ONLY - never runs in production)
        if (isMockMode && !isStrictProduction) {
            console.warn(`[Mock Payment] ⚠️ Auto-approving donation ${donation.id} in 30s (dev mode).`);
            setTimeout(async () => {
                try {
                    // Re-verify on execution
                    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_PAYMENTS !== 'true') return;

                    await prisma.donation.update({
                        where: { id: donation.id },
                        data: { status: 'COMPLETED', paymentId: `PAY-${Math.random().toString(36).substring(7)}` }
                    });
                    console.log(`[Mock Payment] Donation ${donation.id} auto-approved.`);
                } catch (e) {
                    console.error("[Mock Payment] Auto-approval failed", e);
                }
            }, 30000);
        }

        res.status(201).json({
            donation,
            payment: {
                method: 'PIX',
                pixCode: pixCode,
                qrCodeUrl: qrCodeUrl,
                expirationPayload: new Date(Date.now() + 3600000) // 1 hour
            },
            message: 'Doação registrada. Use o código PIX para pagar.'
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
            amount: d.anonymous ? null : d.amount // Hide amount for anonymous
        }));

        // Calculate totals
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
