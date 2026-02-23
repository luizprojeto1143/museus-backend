import { Router } from 'express';
import { prisma } from '../prisma.js';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { Role } from '@prisma/client';
import { formLimiter } from '../middleware/rateLimiter.js';

const router = Router();

const subscribeSchema = z.object({
    email: z.string().email(),
    name: z.string().optional(),
    tenantId: z.string()
});

const unsubscribeSchema = z.object({
    email: z.string().email("Email inválido"),
    tenantId: z.string().min(1, "tenantId é obrigatório")
});

// POST /newsletter/subscribe - Subscribe to newsletter
router.post('/subscribe', formLimiter, async (req, res) => {
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
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: error.errors[0].message });
        }
        console.error('Error subscribing:', error);
        // Generic error
        res.status(500).json({ message: 'Erro ao processar inscrição' });
    }
});

// POST /newsletter/unsubscribe - Unsubscribe from newsletter
// Rate Limit needed here to prevent mass unsubscription attacks
router.post('/unsubscribe', formLimiter, async (req, res) => {
    try {
        const data = unsubscribeSchema.parse(req.body);

        const subscription = await prisma.newsletterSubscription.findUnique({
            where: {
                email_tenantId: { email: data.email, tenantId: data.tenantId }
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
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: error.errors[0].message });
        }
        console.error('Error unsubscribing:', error);
        res.status(500).json({ message: 'Erro ao processar' });
    }
});

// GET /newsletter/list - List subscribers (Admin only)
router.get('/list', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
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
