import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendPushNotificationToMany, PushNotificationPayload } from '../services/fcm.js';

const router = Router();

// Extend Request type for auth middleware
interface AuthenticatedRequest extends Request {
    userId?: string;
    tenantId?: string;
}

// Schema for registering a device token
const registerTokenSchema = z.object({
    token: z.string().min(10),
    platform: z.enum(['web', 'android', 'ios']).default('web'),
    userAgent: z.string().optional(),
});

// Register device token for push notifications
router.post('/register', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { token, platform, userAgent } = registerTokenSchema.parse(req.body);
        const userId = (req as AuthenticatedRequest).userId;
        const tenantId = (req as AuthenticatedRequest).tenantId;

        // Upsert the device token
        const deviceToken = await prisma.deviceToken.upsert({
            where: { token },
            update: {
                userId,
                tenantId,
                platform,
                userAgent,
                active: true,
                lastUsed: new Date(),
            },
            create: {
                token,
                userId,
                tenantId,
                platform,
                userAgent,
                active: true,
            },
        });

        res.json({
            success: true,
            message: 'Device registered for push notifications',
            deviceId: deviceToken.id
        });
    } catch (error) {
        console.error('Failed to register device token:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid request', details: error.errors });
        }
        res.status(500).json({ error: 'Failed to register device' });
    }
});

// Unregister device token
router.delete('/unregister', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { token } = z.object({ token: z.string() }).parse(req.body);

        await prisma.deviceToken.updateMany({
            where: { token },
            data: { active: false },
        });

        res.json({ success: true, message: 'Device unregistered' });
    } catch (error) {
        console.error('Failed to unregister device:', error);
        res.status(500).json({ error: 'Failed to unregister device' });
    }
});

// Send test notification (admin only)
router.post('/test', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).userId;

        // Get user's device tokens
        const tokens = await prisma.deviceToken.findMany({
            where: {
                userId,
                active: true
            },
            select: { token: true },
        });

        if (tokens.length === 0) {
            return res.status(400).json({ error: 'No registered devices found' });
        }

        const payload: PushNotificationPayload = {
            title: '🔔 Teste de Notificação',
            body: 'Se você está vendo isso, as notificações estão funcionando!',
            data: {
                type: 'test',
                url: '/',
            },
        };

        const result = await sendPushNotificationToMany(
            tokens.map((t: { token: string }) => t.token),
            payload
        );

        res.json({
            success: true,
            sent: result.success,
            failed: result.failure
        });
    } catch (error) {
        console.error('Failed to send test notification:', error);
        res.status(500).json({ error: 'Failed to send notification' });
    }
});

// Send notification to all users of a tenant (admin only)
router.post('/broadcast', authMiddleware, async (req: Request, res: Response) => {
    try {
        const tenantId = (req as AuthenticatedRequest).tenantId;
        const { title, body, url } = z.object({
            title: z.string().min(1),
            body: z.string().min(1),
            url: z.string().optional(),
        }).parse(req.body);

        if (!tenantId) {
            return res.status(400).json({ error: 'Tenant ID required' });
        }

        // Get all active device tokens for this tenant
        const tokens = await prisma.deviceToken.findMany({
            where: {
                tenantId,
                active: true
            },
            select: { token: true },
        });

        if (tokens.length === 0) {
            return res.status(400).json({ error: 'No registered devices in this tenant' });
        }

        const payload: PushNotificationPayload = {
            title,
            body,
            data: {
                type: 'broadcast',
                url: url || '/',
            },
        };

        // SAFETY: Process in chunks to avoid blocking Event Loop (CRIT-013)
        // Fire-and-forget (return early) or wait? 
        // For 10k users, waiting might timeout the request. 
        // Better to return 202 Accepted and process in background, OR batch if count is small.
        // We will stick to synchronous batching but with setImmediate to be polite to the loop, 
        // but for a massive userbase this should be a job queue.

        const BATCH_SIZE = 500;
        const allTokens = tokens.map((t: { token: string }) => t.token);

        // If too many, return accepted and process detached
        if (allTokens.length > 1000) {
            // Detached processing
            (async () => {
                for (let i = 0; i < allTokens.length; i += BATCH_SIZE) {
                    const chunk = allTokens.slice(i, i + BATCH_SIZE);
                    await sendPushNotificationToMany(chunk, payload);
                    await new Promise(resolve => setImmediate(resolve)); // Yield to event loop
                }
            })().catch(err => console.error("Background broadcast error", err));

            return res.status(202).json({
                success: true,
                message: "Broadcast started in background",
                totalDevices: allTokens.length
            });
        }

        // Small batch - wait for it
        let successCount = 0;
        let failureCount = 0;

        for (let i = 0; i < allTokens.length; i += BATCH_SIZE) {
            const chunk = allTokens.slice(i, i + BATCH_SIZE);
            const result = await sendPushNotificationToMany(chunk, payload);
            successCount += result.success;
            failureCount += result.failure;
            await new Promise(resolve => setImmediate(resolve)); // Yield
        }

        res.json({
            success: true,
            totalDevices: allTokens.length,
            sent: successCount,
            failed: failureCount
        });
    } catch (error) {
        console.error('Failed to send broadcast notification:', error);
        res.status(500).json({ error: 'Failed to send broadcast' });
    }
});

export default router;
