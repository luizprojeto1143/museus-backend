import { Router } from 'express';
import { prisma } from '../prisma.js';
import os from 'os';

const router = Router();

// GET /health - Deep Health Check
router.get('/', async (req, res) => {
    const startTime = Date.now();

    try {
        // 1. Check database connection
        await prisma.$queryRaw`SELECT 1`;
        const dbLatency = Date.now() - startTime;

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            services: {
                database: {
                    status: 'connected',
                    latency: `${dbLatency}ms`
                }
            },
            system: {
                hostname: os.hostname(),
                platform: os.platform(),
                memory: {
                    total: Math.round(os.totalmem() / 1024 / 1024) + 'MB',
                    free: Math.round(os.freemem() / 1024 / 1024) + 'MB',
                    used: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024) + 'MB'
                },
                load: os.loadavg()
            },
            version: process.env.npm_package_version || '1.0.0'
        });
    } catch (error) {
        console.error('Health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            services: {
                database: {
                    status: 'disconnected',
                    error: error instanceof Error ? error.message : 'Unknown error'
                }
            }
        });
    }
});

// K8s Liveness/Readiness
router.get('/live', (req, res) => res.json({ status: 'alive' }));
router.get('/ready', async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'ready' });
    } catch {
        res.status(503).json({ status: 'not_ready' });
    }
});

export default router;
