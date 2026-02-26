import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimiter.js';
import { asaasService } from '../services/asaasService.js';
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

        // PLATFORM FEE CALCULATION (5%)
        const platformFeeVal = data.amount * 0.05;
        const split = process.env.ASAAS_PLATFORM_WALLET_ID ? [{
            walletId: process.env.ASAAS_PLATFORM_WALLET_ID,
            percentualValue: 5
        }] : undefined;

        // 1. Create/Get Customer in Asaas (Using anonymous info if needed)
        // For donations, we might not have a full customer profile, but let's try with email
        let asaasPaymentData: any = null;
        if (data.donorEmail) {
            try {
                const asaasCustomerId = await asaasService.createCustomer({
                    name: data.donorName || 'Doador Anônimo',
                    email: data.donorEmail
                });

                const dueDate = new Date();
                dueDate.setDate(dueDate.getDate() + 1);

                asaasPaymentData = await asaasService.createPayment({
                    customer: asaasCustomerId,
                    billingType: 'PIX',
                    value: data.amount,
                    dueDate: dueDate.toISOString().split('T')[0],
                    description: `Doação para o Museu: ${data.message || ''}`,
                    split,
                    externalReference: donation.id
                });

                // Get Pix QR Code
                const pixData = await asaasService.getPixQrCode(asaasPaymentData.id);
                if (pixData) {
                    asaasPaymentData.pixQrCode = pixData.encodedImage;
                    asaasPaymentData.pixPayload = pixData.payload;
                }
            } catch (err) {
                console.error("Erro na integração Asaas para doação:", err);
            }
        }

        await prisma.donation.update({
            where: { id: donation.id },
            data: {
                platformFee: platformFeeVal,
                paymentId: asaasPaymentData?.id
            }
        });

        res.status(201).json({
            donation: { ...donation, platformFee: platformFeeVal },
            payment: asaasPaymentData ? {
                method: 'PIX',
                pixCode: asaasPaymentData.pixPayload,
                qrCodeUrl: asaasPaymentData.pixQrCode, // This is base64
                invoiceUrl: asaasPaymentData.invoiceUrl
            } : {
                method: 'PIX',
                message: 'Erro ao gerar pagamento real via Asaas. Tente novamente mais tarde.'
            },
            message: 'Doação registrada.'
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
