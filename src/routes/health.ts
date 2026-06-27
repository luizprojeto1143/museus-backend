import { Router } from 'express';
import { prisma } from '../prisma.js';
import { redisConnection } from '../infrastructure/queue/bullmq.setup.js';
import { stripe } from '../services/stripeService.js';

const router = Router();

// GET /health - Basic Health Check
router.get('/', async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return res.json({ status: 'ok', database: 'connected' });
    } catch (error) {
        console.error('Health check failed:', error);
        return res.status(500).json({ status: 'unhealthy', database: 'disconnected' });
    }
});

// K8s Liveness/Readiness
router.get('/live', (req, res) => res.json({ status: 'alive' }));

router.get('/ready', async (req, res) => {
    try {
        // 1. Check Database
        const dbPromise = prisma.$queryRaw`SELECT 1`;
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Database query timed out (5s)')), 5000)
        );
        await Promise.race([dbPromise, timeoutPromise]);

        // 2. Check Redis (if configured)
        let redisStatus = 'skipped';
        if (redisConnection) {
            const redisPingPromise = redisConnection.ping();
            const redisTimeout = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Redis ping timed out (5s)')), 5000)
            );
            const pingRes = await Promise.race([redisPingPromise, redisTimeout]);
            redisStatus = pingRes === 'PONG' ? 'connected' : 'unhealthy';
        }

        // 3. Check Stripe connectivity (if not in offline billing mode)
        let stripeStatus = 'skipped';
        const isPaymentsDisabled = process.env.PAYMENTS_DISABLED === 'true' || process.env.BILLING_MODE === 'disabled';
        if (!isPaymentsDisabled) {
            const stripePromise = stripe.paymentIntents.list({ limit: 1 });
            const stripeTimeout = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Stripe API query timed out (5s)')), 5000)
            );
            await Promise.race([stripePromise, stripeTimeout]);
            stripeStatus = 'connected';
        }

        return res.json({ 
            status: 'ready',
            checks: {
                database: 'connected',
                redis: redisStatus,
                stripe: stripeStatus
            }
        });
    } catch (error: any) {
        console.error('Readiness check failed:', error);
        return res.status(503).json({ 
            status: 'not_ready', 
            reason: error.message || 'Check failed' 
        });
    }
});

export default router;
