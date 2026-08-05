import { Router } from 'express';
import { prisma } from '../prisma.js';
import { redisConnection } from '../infrastructure/queue/bullmq.setup.js';
import { stripe } from '../services/stripeService.js';

const router = Router();

import os from 'os';

// GET /health - Basic & Rich Health Check for Master Panel
router.get('/', async (req, res) => {
    try {
        const start = Date.now();
        await prisma.$queryRaw`SELECT 1`;
        const latency = Date.now() - start;

        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        const systemCpuLoad = `${Math.round((os.loadavg()[0] || 0.1) * 100)}%`;

        return res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: Math.round(process.uptime()),
            services: {
                database: {
                    status: 'connected',
                    latency: `${latency}`
                }
            },
            system: {
                hostname: os.hostname() || 'Cloud-Core-Node',
                platform: os.platform() || 'linux',
                memory: {
                    total: `${Math.round(totalMem / 1024 / 1024)}Mb`,
                    free: `${Math.round(freeMem / 1024 / 1024)}Mb`,
                    used: `${Math.round(usedMem / 1024 / 1024)}Mb`
                },
                cpu: systemCpuLoad
            },
            version: 'v2.1.0-sovereign'
        });
    } catch (error: any) {
        console.error('Health check failed:', error);
        return res.status(500).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            uptime: Math.round(process.uptime()),
            services: {
                database: {
                    status: 'disconnected',
                    error: error.message || 'Connection failed'
                }
            },
            system: {
                hostname: os.hostname() || 'Node-Offline',
                platform: os.platform() || 'Unknown',
                memory: { total: '0Mb', free: '0Mb', used: '0Mb' },
                cpu: '0%'
            },
            version: 'Unknown'
        });
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
