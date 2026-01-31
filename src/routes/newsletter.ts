import { Router } from 'express';
import { prisma } from '../prisma.js';
import { z } from 'zod';

const router = Router();

const subscribeSchema = z.object({
    email: z.string().email(),
    name: z.string().optional(),
    tenantId: z.string()
});

// POST /newsletter/subscribe - Subscribe to newsletter
router.post('/subscribe', async (req, res) => {
    try {
        const data = subscribeSchema.parse(req.body);

        // Check if already subscribed
        const existing = await prisma.newsletterSubscription.findUnique({
            where: {
                email_tenantId: { email: data.email, tenantId: data.tenantId }
            }
        });

        if (existing) {
            if (!existing.active) {
                // Reactivate silently
                await prisma.newsletterSubscription.update({
                    where: { id: existing.id },
                    data: { active: true }
                });
            }
            // Idempotent success (anti-enumeration)
            return res.status(201).json({ message: 'Inscrito com sucesso!' });
        }

        await prisma.newsletterSubscription.create({
            data: {
                email: data.email,
                name: data.name,
                tenantId: data.tenantId
            }
        });

        res.status(201).json({ message: 'Inscrito com sucesso!' });
    } catch (error) {
        console.error('Error subscribing:', error);
        // Generic error
        res.status(500).json({ message: 'Erro ao processar inscrição' });
    }
});

// POST /newsletter/unsubscribe - Unsubscribe from newsletter
// Rate Limit needed here to prevent mass unsubscription attacks
router.post('/unsubscribe', async (req, res) => {
    try {
        const { email, tenantId } = req.body;

        if (!email || !tenantId) {
            return res.status(400).json({ message: 'Dados inválidos' });
        }

        const subscription = await prisma.newsletterSubscription.findUnique({
            where: {
                email_tenantId: { email, tenantId }
            }
        });

        if (subscription) {
            await prisma.newsletterSubscription.update({
                where: { id: subscription.id },
                data: { active: false }
            });
        }

        // Anti-enumeration/Privacy: Always return success
        res.json({ message: 'Solicitação processada' });
    } catch (error) {
        console.error('Error unsubscribing:', error);
        res.status(500).json({ message: 'Erro ao processar' });
    }
});

// GET /newsletter/list - List subscribers (Admin only)
router.get('/list', async (req, res) => {
    try {
        const { tenantId } = req.query;

        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId é obrigatório' });
        }

        const subscribers = await prisma.newsletterSubscription.findMany({
            where: { tenantId: tenantId as string, active: true },
            orderBy: { createdAt: 'desc' }
        });

        res.json(subscribers);
    } catch (error) {
        console.error('Error listing subscribers:', error);
        res.status(500).json({ message: 'Erro ao listar inscritos' });
    }
});

export default router;
