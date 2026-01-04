import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

// Schemas
const ticketSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    type: z.enum(['FREE', 'PAID']),
    price: z.number().min(0),
    quantity: z.number().int().min(1),
    absorbFee: z.boolean().optional(),
    minBuy: z.number().int().min(1).optional(),
    maxBuy: z.number().int().min(1).optional(),
    salesStartDate: z.string().optional().nullable(),
    salesEndDate: z.string().optional().nullable(),
    status: z.enum(['ACTIVE', 'PAUSED', 'SOLD_OUT', 'EXPIRED']).optional()
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
            }
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
        // TODO: Add strict tenant check if needed (via event -> tenantId)

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
