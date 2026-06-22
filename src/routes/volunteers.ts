import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /volunteers — List volunteers
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.user!.role === 'MASTER' && req.query.tenantId) ? (req.query.tenantId as string) : req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const volunteers = await prisma.volunteer.findMany({
            where: { tenantId },
            include: { _count: { select: { volunteerShifts: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json(volunteers);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar voluntários' });
    }
});

// POST /volunteers — Register volunteer
router.post('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const { name, email, phone, skills, availability } = req.body;
        const volunteer = await prisma.volunteer.create({
            data: { name, email, phone, skills: skills || [], availability, tenantId }
        });
        res.status(201).json(volunteer);
    } catch (error: any) {
        if (error.code === 'P2002') return res.status(409).json({ message: 'Voluntário já cadastrado' });
        console.error(error);
        res.status(500).json({ message: 'Erro ao cadastrar voluntário' });
    }
});

// POST /volunteers/:id/shifts — Add shift
router.post('/:id/shifts', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        const { date, startTime, endTime, hours, activity } = req.body;
        const shift = await prisma.volunteerShift.create({
            data: { volunteerId: id, date: new Date(date), startTime, endTime, hours: hours || 0, activity }
        });
        // Update total hours
        const totalHours = await prisma.volunteerShift.aggregate({
            where: { volunteerId: id, confirmed: true },
            _sum: { hours: true }
        });
        await prisma.volunteer.update({
            where: { id },
            data: { totalHours: totalHours._sum.hours || 0 }
        });
        res.status(201).json(shift);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao registrar turno' });
    }
});

// PATCH /volunteers/:id/shifts/:shiftId — Confirm shift
router.patch('/:id/shifts/:shiftId', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { shiftId, id } = req.params;
        const shift = await prisma.volunteerShift.update({
            where: { id: shiftId },
            data: { confirmed: true }
        });
        // Update total hours
        const totalHours = await prisma.volunteerShift.aggregate({
            where: { volunteerId: id, confirmed: true },
            _sum: { hours: true }
        });
        await prisma.volunteer.update({ where: { id }, data: { totalHours: totalHours._sum.hours || 0 } });
        res.json(shift);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao confirmar turno' });
    }
});

// GET /volunteers/:id/shifts — List shifts
router.get('/:id/shifts', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        const shifts = await prisma.volunteerShift.findMany({
            where: { volunteerId: id },
            orderBy: { date: 'desc' }
        });
        res.json(shifts);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar turnos' });
    }
});

export default router;
