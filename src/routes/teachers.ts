import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /teachers — List teachers for this tenant
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.query.tenantId as string) || req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });

        const teachers = await prisma.teacherProfile.findMany({
            where: { tenantId },
            include: { _count: { select: { schoolVisits: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json(teachers);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar professores' });
    }
});

// POST /teachers — Register teacher
router.post('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const { name, email, phone, school, city, subject } = req.body;
        const teacher = await prisma.teacherProfile.create({
            data: { name, email, phone, school, city, subject, tenantId }
        });
        res.status(201).json(teacher);
    } catch (error: any) {
        if (error.code === 'P2002') return res.status(409).json({ message: 'Professor já cadastrado' });
        console.error(error);
        res.status(500).json({ message: 'Erro ao cadastrar professor' });
    }
});

// GET /teachers/visits — List school visits
router.get('/visits', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.query.tenantId as string) || req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });

        const visits = await prisma.schoolVisit.findMany({
            where: { tenantId },
            include: {
                teacherProfile: { select: { name: true, email: true, school: true } },
                _count: { select: { postVisitActivities: true } }
            },
            orderBy: { visitDate: 'desc' }
        });
        res.json(visits);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar visitas' });
    }
});

// POST /teachers/visits — Schedule school visit
router.post('/visits', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const { teacherId, schoolName, grade, studentCount, ageGroup, visitDate, selectedWorkIds, notes } = req.body;

        const visit = await prisma.schoolVisit.create({
            data: { teacherId, schoolName, grade, studentCount, ageGroup, visitDate: new Date(visitDate), selectedWorkIds: selectedWorkIds || [], notes, tenantId }
        });
        res.status(201).json(visit);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao agendar visita' });
    }
});

// PATCH /teachers/visits/:id — Update visit status
router.patch('/visits/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        const { status, certificateIssued } = req.body;
        const visit = await prisma.schoolVisit.update({
            where: { id },
            data: { ...(status && { status }), ...(certificateIssued !== undefined && { certificateIssued }) }
        });
        res.json(visit);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao atualizar visita' });
    }
});

// POST /teachers/activities — Create post-visit activity
router.post('/activities', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const { title, description, questions, ageGroup, workIds, schoolVisitId, autoSend } = req.body;

        const activity = await prisma.postVisitActivity.create({
            data: { title, description, questions, ageGroup, workIds: workIds || [], schoolVisitId, autoSend: autoSend ?? true, tenantId }
        });
        res.status(201).json(activity);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar atividade' });
    }
});

export default router;
