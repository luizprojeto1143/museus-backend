import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';

const router = Router();

// Middleware to log actions
export const createAuditLog = async (
    action: string,
    entity: string,
    entityId: string | null,
    userId: string | null,
    userEmail: string | null,
    tenantId: string,
    oldData?: any,
    newData?: any,
    req?: any
) => {
    try {
        await prisma.auditLog.create({
            data: {
                action,
                entity,
                entityId,
                userId,
                userEmail,
                tenantId,
                oldData,
                newData,
                ipAddress: req?.ip || req?.socket?.remoteAddress,
                userAgent: req?.headers?.['user-agent']
            }
        });
    } catch (error) {
        console.error('Error creating audit log:', error);
    }
};

// GET /audit-logs - List audit logs (Admin only)
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req: any, res) => {
    try {
        const user = req.user;
        const { entity, action, limit = 100, offset = 0 } = req.query;

        const where: any = {};

        // MASTER pode filtrar por qualquer tenant; ADMIN só vê o próprio
        if (user.role === 'MASTER') {
            if (req.query.tenantId) where.tenantId = req.query.tenantId;
        } else {
            // ADMIN: força o tenant dele, ignora qualquer ?tenantId externo
            where.tenantId = user.tenantId;
        }

        if (entity) where.entity = entity;
        if (action) where.action = action;

        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: Number(limit),
                skip: Number(offset)
            }),
            prisma.auditLog.count({ where })
        ]);

        res.json({
            logs,
            total,
            limit: Number(limit),
            offset: Number(offset)
        });
    } catch (error) {
        console.error('Error fetching audit logs:', error);
        res.status(500).json({ message: 'Erro ao buscar logs' });
    }
});

// GET /audit-logs/entity/:entity/:id - Get logs for specific entity
router.get('/entity/:entity/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req: any, res) => {
    try {
        const { entity, id } = req.params;
        const user = req.user;

        // MASTER pode filtrar por qualquer tenant; ADMIN só vê o próprio
        const tenantFilter: any = {};
        if (user.role === 'MASTER') {
            if (req.query.tenantId) tenantFilter.tenantId = req.query.tenantId;
            // sem filtro = MASTER vê todos
        } else {
            // ADMIN: força o tenant dele — impede leitura de entidades de outro tenant
            if (!user.tenantId) return res.status(403).json({ message: 'Tenant não identificado' });
            tenantFilter.tenantId = user.tenantId;
        }

        const logs = await prisma.auditLog.findMany({
            where: {
                entity,
                entityId: id,
                ...tenantFilter
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(logs);
    } catch (error) {
        console.error('Error fetching entity logs:', error);
        res.status(500).json({ message: 'Erro ao buscar logs da entidade' });
    }
});

// GET /audit-logs/summary - Get summary of recent activity
router.get('/summary', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req: any, res) => {
    try {
        const user = req.user;
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours

        const where: any = { createdAt: { gte: since } };

        // MASTER pode filtrar por qualquer tenant; ADMIN só vê o próprio
        if (user.role === 'MASTER') {
            if (req.query.tenantId) where.tenantId = req.query.tenantId;
        } else {
            where.tenantId = user.tenantId;
        }

        const [actionCounts, entityCounts, recentLogs] = await Promise.all([
            prisma.auditLog.groupBy({
                by: ['action'],
                where,
                _count: true
            }),
            prisma.auditLog.groupBy({
                by: ['entity'],
                where,
                _count: true
            }),
            prisma.auditLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: 10
            })
        ]);

        res.json({
            period: '24h',
            actionCounts,
            entityCounts,
            recentLogs
        });
    } catch (error) {
        console.error('Error fetching audit summary:', error);
        res.status(500).json({ message: 'Erro ao buscar resumo' });
    }
});

export default router;
