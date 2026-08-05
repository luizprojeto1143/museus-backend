import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { limiter } from '../../middleware/rateLimiter.js';
import { z } from 'zod';
import { getPlatformFee } from '../../services/fee.service.js';
import { PlatformFeeSource } from '@prisma/client';

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
        if (!tenant?.stripeConnectId) {
            await prisma.donation.delete({ where: { id: donation.id } });
            return res.status(400).json({ error: 'Este museu nao possui conta Stripe Connect configurada.' });
        }

        // 2. Integration with Stripe
        let stripePaymentData: any = null;
        try {
            const { stripeService } = await import('../../services/stripeService.js');
            
            const amountCents = Math.round(data.amount * 100);

            // Sprint 15: Calcular taxa via Central de Taxas
            const feeResult = await getPlatformFee({
                tenantId: data.tenantId,
                sourceType: PlatformFeeSource.DONATION,
                amountCents
            });
            const platformFeeCents = feeResult.platformFeeCents;

            const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

            // Create/Get Customer
            const stripeCustomerId = await stripeService.createCustomer({
                name: data.donorName || 'Doador Anônimo',
                email: data.donorEmail || 'anon@example.com',
                userId: 'guest'
            });

            // Create Split Session
            const session = await stripeService.createSplitPaymentSession({
                customerId: stripeCustomerId,
                amount: feeResult.buyerPaysCents, // BUYER paga base + taxa
                description: `Doação para o Museu: ${tenant?.name || 'Cultura'}`,
                connectedAccountId: tenant.stripeConnectId, 
                applicationFeeAmount: platformFeeCents,
                successUrl: `${frontendUrl}/donations/success?id=${donation.id}`,
                cancelUrl: `${frontendUrl}/donations/cancel?id=${donation.id}`
            });

            stripePaymentData = {
                id: session.id,
                checkoutUrl: session.url
            };

            // Update Donation with Stripe ID + fee snapshot
            await prisma.donation.update({
                where: { id: donation.id },
                data: {
                    platformFee: platformFeeCents / 100,
                    stripeCheckoutSessionId: session.id,
                    // Sprint 15 â€” fee snapshot
                    feeConfigId: feeResult.configId,
                    platformFeePercent: feeResult.percentage,
                    platformFeeAmountCents: platformFeeCents,
                    feePaidBy: feeResult.feePaidBy
                }
            });

        } catch (err) {
            console.error("Erro na integração Stripe para doação:", err);
            try {
                await prisma.donation.delete({
                    where: { id: donation.id }
                });
            } catch (dbErr) {
                console.error("Erro ao deletar doação falha do banco:", dbErr);
            }
            return res.status(400).json({ error: "Falha ao gerar sessão de pagamento no Stripe." });
        }

        res.status(201).json({
            donation,
            payment: {
                method: 'STRIPE',
                checkoutUrl: stripePaymentData.checkoutUrl
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
        const targetTenantId = req.user!.role === 'MASTER' ? (tenantId as string | undefined) : req.user!.tenantId;

        if (!targetTenantId) {
            return res.status(400).json({ message: 'tenantId é obrigatório' });
        }

        const [total, completed, pending] = await Promise.all([
            prisma.donation.aggregate({
                where: { tenantId: targetTenantId, status: 'COMPLETED' },
                _sum: { amount: true },
                _count: true
            }),
            prisma.donation.count({
                where: { tenantId: targetTenantId, status: 'COMPLETED' }
            }),
            prisma.donation.count({
                where: { tenantId: targetTenantId, status: 'PENDING' }
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
