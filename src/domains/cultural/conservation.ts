import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';

const router = Router();

function targetTenant(req: any, requestedTenantId?: string) {
    return req.user!.role === 'MASTER' ? requestedTenantId : req.user!.tenantId;
}

async function assertWorkInTenant(workId: string, tenantId: string) {
    const work = await prisma.work.findFirst({
        where: { id: workId, tenantId, deletedAt: null },
        select: { id: true }
    });
    if (!work) {
        throw Object.assign(new Error('Obra nao encontrada neste tenant'), { status: 404 });
    }
}

// GET /conservation - List records for a work or tenant
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = targetTenant(req, req.query.tenantId as string | undefined);
        const workId = req.query.workId as string | undefined;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatorio' });
        if (workId) await assertWorkInTenant(workId, tenantId);

        const records = await prisma.conservationRecord.findMany({
            where: { tenantId, ...(workId ? { workId } : {}) },
            orderBy: { performedAt: 'desc' }
        });
        res.json(records);
    } catch (error: any) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar registros' });
    }
});

// POST /conservation - Create record
router.post('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = targetTenant(req, req.body.tenantId);
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatorio' });
        const { workId, type, description, responsibleName, condition, notes, attachments, performedAt, nextScheduled } = req.body;
        await assertWorkInTenant(workId, tenantId);

        const record = await prisma.conservationRecord.create({
            data: {
                workId,
                type,
                description,
                responsibleName,
                condition,
                notes,
                attachments,
                performedAt: performedAt ? new Date(performedAt) : new Date(),
                nextScheduled: nextScheduled ? new Date(nextScheduled) : null,
                tenantId
            }
        });
        res.status(201).json(record);
    } catch (error: any) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar registro' });
    }
});

// GET /conservation/loans - List loans
router.get('/loans', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = targetTenant(req, req.query.tenantId as string | undefined);
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatorio' });
        const loans = await prisma.workLoan.findMany({
            where: { tenantId },
            orderBy: { departureDate: 'desc' }
        });
        res.json(loans);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar emprestimos' });
    }
});

// POST /conservation/loans - Create loan
router.post('/loans', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = targetTenant(req, req.body.tenantId);
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatorio' });
        const { workId, borrowerName, borrowerContact, purpose, departureDate, expectedReturn, conditions, insuranceInfo } = req.body;
        await assertWorkInTenant(workId, tenantId);

        const loan = await prisma.workLoan.create({
            data: {
                workId,
                borrowerName,
                borrowerContact,
                purpose,
                departureDate: new Date(departureDate),
                expectedReturn: expectedReturn ? new Date(expectedReturn) : null,
                conditions,
                insuranceInfo,
                tenantId
            }
        });
        res.status(201).json(loan);
    } catch (error: any) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar emprestimo' });
    }
});

// PATCH /conservation/loans/:id - Update loan
router.patch('/loans/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        const { status, actualReturn } = req.body;
        const loan = await prisma.workLoan.findUnique({ where: { id } });
        if (!loan) return res.status(404).json({ message: 'Emprestimo nao encontrado' });
        if (req.user!.role !== 'MASTER' && loan.tenantId !== req.user!.tenantId) {
            return res.status(403).json({ message: 'Sem permissao' });
        }

        const updated = await prisma.workLoan.update({
            where: { id },
            data: {
                ...(status && { status }),
                ...(actualReturn && { actualReturn: new Date(actualReturn) })
            }
        });
        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao atualizar emprestimo' });
    }
});

export default router;
