import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';

const router = Router();

// GET /conservation — List records for a work or tenant
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.user!.role === 'MASTER' && req.query.tenantId) ? (req.query.tenantId as string) : req.user!.tenantId;
        const workId = req.query.workId as string;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const records = await prisma.conservationRecord.findMany({
            where: { tenantId, ...(workId ? { workId } : {}) },
            orderBy: { performedAt: 'desc' }
        });
        res.json(records);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar registros' });
    }
});

// POST /conservation — Create record
router.post('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const { workId, type, description, responsibleName, condition, notes, attachments, performedAt, nextScheduled } = req.body;
        const record = await prisma.conservationRecord.create({
            data: {
                workId, type, description, responsibleName, condition, notes, attachments,
                performedAt: performedAt ? new Date(performedAt) : new Date(),
                nextScheduled: nextScheduled ? new Date(nextScheduled) : null,
                tenantId
            }
        });
        res.status(201).json(record);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar registro' });
    }
});

// GET /work-loans — List loans
router.get('/loans', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.user!.role === 'MASTER' && req.query.tenantId) ? (req.query.tenantId as string) : req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const loans = await prisma.workLoan.findMany({
            where: { tenantId },
            orderBy: { departureDate: 'desc' }
        });
        res.json(loans);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar empréstimos' });
    }
});

// POST /conservation/loans — Create loan
router.post('/loans', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const { workId, borrowerName, borrowerContact, purpose, departureDate, expectedReturn, conditions, insuranceInfo } = req.body;
        const loan = await prisma.workLoan.create({
            data: {
                workId, borrowerName, borrowerContact, purpose,
                departureDate: new Date(departureDate),
                expectedReturn: expectedReturn ? new Date(expectedReturn) : null,
                conditions, insuranceInfo, tenantId
            }
        });
        res.status(201).json(loan);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar empréstimo' });
    }
});

// PATCH /conservation/loans/:id — Update loan (return, etc)
router.patch('/loans/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        const { status, actualReturn } = req.body;
        const loan = await prisma.workLoan.update({
            where: { id },
            data: { ...(status && { status }), ...(actualReturn && { actualReturn: new Date(actualReturn) }) }
        });
        res.json(loan);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao atualizar empréstimo' });
    }
});

export default router;
