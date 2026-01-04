import { Router } from 'express';
import { prisma } from '../prisma.js';
import os from 'os';

const router = Router();

// GET /health - Basic health check
router.get('/', async (req, res) => {
    const startTime = Date.now();

    try {
        // Check database connection
        await prisma.$queryRaw`SELECT 1`;
        const dbLatency = Date.now() - startTime;

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            database: {
                status: 'connected',
                latency: `${dbLatency}ms`
            },
            system: {
                hostname: os.hostname(),
                platform: os.platform(),
                memory: {
                    total: Math.round(os.totalmem() / 1024 / 1024) + 'MB',
                    free: Math.round(os.freemem() / 1024 / 1024) + 'MB',
                    used: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024) + 'MB'
                },
                cpu: os.cpus().length + ' cores'
            },
            version: process.env.npm_package_version || '1.0.0'
        });
    } catch (error) {
        console.error('Health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            database: {
                status: 'disconnected',
                error: error instanceof Error ? error.message : 'Unknown error'
            }
        });
    }
});

// GET /health/ready - Readiness probe
router.get('/ready', async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ ready: true });
    } catch {
        res.status(503).json({ ready: false });
    }
});

// GET /health/live - Liveness probe
router.get('/live', (req, res) => {
    res.json({ alive: true });
});

export default router;
