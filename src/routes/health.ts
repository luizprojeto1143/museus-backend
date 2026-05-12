import { Router } from 'express';
import { prisma } from '../prisma.js';
import os from 'os';

const router = Router();

// GET /health - Deep Health Check
router.get('/', async (req, res) => {
    const startTime = Date.now();

    try {
        // 1. Check database connection with a strict timeout
        const dbPromise = prisma.$queryRaw`SELECT 1`;
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Database query timed out (10s)')), 10000)
        );

        await Promise.race([dbPromise, timeoutPromise]);
        const dbLatency = Date.now() - startTime;

        // 2. Critical Column Check (Diagnostic) - also with timeout
        const columnCheck = {
            work_deletedAt: false,
            tenant_deletedAt: false,
            event_deletedAt: false,
            user_stripeCustomerId: false,
            provider_stripeCustomerId: false,
            provider_stripeConnectId: false
        };

        try {
            const checkCols = async () => {
                const workCols: any[] = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'Work' AND column_name = 'deletedAt'`;
                columnCheck.work_deletedAt = workCols.length > 0;
                
                const tenantCols: any[] = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'Tenant' AND column_name = 'deletedAt'`;
                columnCheck.tenant_deletedAt = tenantCols.length > 0;

                const eventCols: any[] = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'Event' AND column_name = 'deletedAt'`;
                columnCheck.event_deletedAt = eventCols.length > 0;

                const userStripe: any[] = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'stripeCustomerId'`;
                columnCheck.user_stripeCustomerId = userStripe.length > 0;

                const providerStripe: any[] = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'AccessibilityProvider' AND column_name = 'stripeCustomerId'`;
                columnCheck.provider_stripeCustomerId = providerStripe.length > 0;

                const providerConnect: any[] = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'AccessibilityProvider' AND column_name = 'stripeConnectId'`;
                columnCheck.provider_stripeConnectId = providerConnect.length > 0;
            };
            await Promise.race([checkCols(), new Promise((_, r) => setTimeout(r, 8000))]);
        } catch (colErr) {
            console.error('Column diagnostic failed or timed out:', colErr);
        }

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            debug: {
                db_host: new URL(process.env.DATABASE_URL || "http://localhost").hostname,
                db_port: new URL(process.env.DATABASE_URL || "http://localhost").port || "5432",
                columns: columnCheck
            },
            services: {
                database: {
                    status: 'connected',
                    latency: `${dbLatency}ms`
                }
            },
            system: {
                hostname: os.hostname(),
                platform: os.platform(),
                load: os.loadavg()
            },
            version: process.env.npm_package_version || '1.0.0'
        });
    } catch (error) {
        console.error('Health check failed:', error);
        res.status(200).json({ 
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error_type: error instanceof Error ? error.constructor.name : 'Unknown',
            message: error instanceof Error ? error.message : String(error),
            services: {
                database: {
                    status: 'disconnected'
                }
            }
        });
    }
});

// K8s Liveness/Readiness
router.get('/live', (req, res) => res.json({ status: 'alive' }));
router.get('/ready', (req, res) => res.json({ status: 'ready_permissive' }));

export default router;
