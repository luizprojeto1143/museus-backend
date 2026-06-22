import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

// GET /health - Basic Health Check
router.get('/', async (req, res) => {
    try {
        // Check database connection with a strict timeout
        const dbPromise = prisma.$queryRaw`SELECT 1`;
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Database query timed out (10s)')), 10000)
        );

        await Promise.race([dbPromise, timeoutPromise]);
        
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
        const dbPromise = prisma.$queryRaw`SELECT 1`;
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Database query timed out (10s)')), 10000)
        );

        await Promise.race([dbPromise, timeoutPromise]);
        
        return res.json({ status: 'ready' });
    } catch (error) {
        console.error('Readiness check failed:', error);
        return res.status(503).json({ status: 'not_ready', database: 'disconnected' });
    }
});

export default router;
