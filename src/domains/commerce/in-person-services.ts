import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { Role } from "@prisma/client";
import { z } from "zod";

const router = Router();

// GET / - List in-person services for a tenant
// Admins/Producers see only active ones (or all if we want, but usually active).
// Master can see all.
router.get("/", authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === Role.MASTER ? (req.query.tenantId as string) : user.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: "Tenant ID required" });
        }

        const where: any = { tenantId };

        // If not master, maybe only show active ones to visitors/admins for booking?
        if (user.role !== Role.MASTER) {
            where.active = true;
        }

        const services = await prisma.inPersonService.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        return res.json(services);
    } catch (err) {
        console.error("Error listing in-person services", err);
        return res.status(500).json({ message: "Error listing services" });
    }
});

// POST / - Create a new in-person service (Master only)
const createSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    active: z.boolean().default(true),
    tenantId: z.string().min(1)
});

router.post("/", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
    try {
        const data = createSchema.parse(req.body);

        const service = await prisma.inPersonService.create({
            data: data as any
        });

        return res.status(201).json(service);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ message: "Invalid data", errors: err.errors });
        }
        console.error("Error creating in-person service", err);
        return res.status(500).json({ message: "Error creating service" });
    }
});

// PUT /:id - Update an in-person service (Master only)
const updateSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    active: z.boolean().optional()
});

router.put("/:id", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const data = updateSchema.parse(req.body);

        const service = await prisma.inPersonService.update({
            where: { id },
            data
        });

        return res.json(service);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ message: "Invalid data", errors: err.errors });
        }
        console.error("Error updating in-person service", err);
        return res.status(500).json({ message: "Error updating service" });
    }
});

// DELETE /:id - Delete an in-person service (Master only)
router.delete("/:id", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.inPersonService.delete({
            where: { id }
        });

        return res.json({ message: "Service deleted successfully" });
    } catch (err) {
        console.error("Error deleting in-person service", err);
        return res.status(500).json({ message: "Error deleting service" });
    }
});

export default router;
