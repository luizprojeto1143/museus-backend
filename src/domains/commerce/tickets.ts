import { Router } from 'express';
import { prisma } from '../../prisma.js'; // Use singleton
import { Role } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../../middleware/auth.js';

const router = Router();

// Schemas
const ticketSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  description: z.string().optional(),
  type: z.enum(['FREE', 'PAID']),
  price: z.any().transform(v => {
    if (v === null || v === "" || v === undefined) return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }).refine(v => v >= 0, "Preço deve ser positivo"),
  quantity: z.any().transform(v => {
    if (v === null || v === "" || v === undefined) return 1;
    const n = Math.floor(Number(v));
    return isNaN(n) ? 1 : n;
  }).refine(v => v >= 1, "Quantidade mínima de 1"),
  absorbFee: z.boolean().optional(),
  minBuy: z.any().optional().transform(v => {
    if (v === null || v === "" || v === undefined) return undefined;
    const n = Math.floor(Number(v));
    return isNaN(n) ? undefined : n;
  }),
  maxBuy: z.any().optional().transform(v => {
    if (v === null || v === "" || v === undefined) return undefined;
    const n = Math.floor(Number(v));
    return isNaN(n) ? undefined : n;
  }),
  salesStartDate: z.string().optional().nullable(),
  salesEndDate: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'PAUSED', 'SOLD_OUT', 'EXPIRED']).optional()
});

// GET /tickets - List all tickets for the authenticated user's tenant
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;

        if (!tenantId && user.role !== 'MASTER') {
            return res.status(400).json({ error: 'Tenant context required' });
        }

        const where: any = {};
        if (tenantId) {
            where.event = { tenantId };
        }

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const [tickets, total] = await Promise.all([
            prisma.ticket.findMany({
                where,
                include: { event: { select: { title: true } } },
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: skip
            }),
            prisma.ticket.count({ where })
        ]);

        res.json({
            data: tickets,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error("Error fetching tickets", error);
        res.status(500).json({ error: 'Failed to fetch tickets' });
    }
});

// GET /events/:eventId/tickets - public or logic based
router.get('/events/:eventId/tickets', async (req, res) => {
    const { eventId } = req.params;
    try {
        const tickets = await prisma.ticket.findMany({
            where: { eventId },
            orderBy: { price: 'asc' }
        });
        res.json(tickets);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tickets' });
    }
});

// POST /events/:eventId/tickets - Admin only
router.post('/events/:eventId/tickets', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    const { eventId } = req.params;
    try {
        const data = ticketSchema.parse(req.body);
        const ticket = await prisma.ticket.create({
            data: {
                ...data,
                eventId,
                salesStartDate: data.salesStartDate ? new Date(data.salesStartDate) : null,
                salesEndDate: data.salesEndDate ? new Date(data.salesEndDate) : null,
            } as any
        });
        res.status(201).json(ticket);
    } catch (error) {
        res.status(400).json({ error: 'Invalid data', details: error });
    }
});

// PUT /tickets/:id
router.put('/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    const { id } = req.params;
    try {
        const data = ticketSchema.partial().parse(req.body);

        // Validate that the ticket belongs to the user's tenant
        const existing = await prisma.ticket.findUnique({
            where: { id },
            include: { event: true }
        });

        if (!existing) return res.status(404).json({ error: 'Ticket not found' });

        // Verificação strict de tenant
        const user = req.user!;
        if (user.role !== 'MASTER' && existing.event.tenantId !== user.tenantId) {
            return res.status(403).json({ error: 'Sem permissão para editar ticket de outro tenant' });
        }

        const ticket = await prisma.ticket.update({
            where: { id },
            data: {
                ...data,
                salesStartDate: data.salesStartDate ? new Date(data.salesStartDate) : undefined,
                salesEndDate: data.salesEndDate ? new Date(data.salesEndDate) : undefined,
            }
        });
        res.json(ticket);
    } catch (error) {
        res.status(400).json({ error: 'Invalid data', details: error });
    }
});

// DELETE /tickets/:id
router.delete('/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.ticket.delete({ where: { id } });
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete ticket' });
    }
});

export const ticketsRouter = router;
