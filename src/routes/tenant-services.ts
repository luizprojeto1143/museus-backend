import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { z } from "zod";

const router = Router();

// GET /:tenantId - List enabled services for a specific tenant (Public/Visitor scheduling can read it)
router.get("/:tenantId", async (req, res) => {
    try {
        const { tenantId } = req.params;

        const enabledServices = await prisma.tenantInPersonService.findMany({
            where: { tenantId, active: true, inPersonService: { active: true } },
            include: {
                inPersonService: true
            }
        });

        // Flatten the response so it looks like the original InPersonService list for the frontend
        const services = enabledServices.map(es => ({
            id: es.inPersonService.id,
            name: es.inPersonService.name,
            description: es.inPersonService.description,
            active: es.active
        }));

        return res.json(services);
    } catch (err) {
        console.error("Error listing tenant services", err);
        return res.status(500).json({ message: "Error listing tenant services" });
    }
});

// GET /admin/:tenantId - List ALL master services and indicate if the tenant has them enabled (Admin Config)
router.get("/admin/:tenantId", authMiddleware, async (req, res) => {
    try {
        const { tenantId } = req.params;
        const user = req.user!;

        if (user.role !== Role.MASTER && user.tenantId !== tenantId) {
            return res.status(403).json({ message: "Forbidden" });
        }

        const masterTenantId = "8cc9b546-7f7d-4908-a6cf-acdd7b86982b"; // QS Inclusão

        // Find all active services globally (from Master)
        const allServices = await prisma.inPersonService.findMany({
            where: { tenantId: masterTenantId, active: true },
            orderBy: { name: 'asc' }
        });

        // Find which ones this tenant has enabled
        const enabledServices = await prisma.tenantInPersonService.findMany({
            where: { tenantId }
        });

        const enabledMap = new Map(enabledServices.map(es => [es.inPersonServiceId, es]));

        const result = allServices.map(srv => {
            const es = enabledMap.get(srv.id);
            return {
                id: srv.id,
                name: srv.name,
                description: srv.description,
                enabled: !!es?.active,
                tenantServiceId: es?.id || null
            };
        });

        return res.json(result);
    } catch (err) {
        console.error("Error listing admin services", err);
        return res.status(500).json({ message: "Error" });
    }
});

// POST / - Enable or toggle a service for a tenant (Admin/Master only)
const toggleSchema = z.object({
    tenantId: z.string().uuid(),
    inPersonServiceId: z.string().uuid(),
    active: z.boolean()
});

router.post("/", authMiddleware, async (req, res) => {
    try {
        const data = toggleSchema.parse(req.body);
        const user = req.user!;

        if (user.role !== Role.MASTER && user.tenantId !== data.tenantId) {
            return res.status(403).json({ message: "Forbidden" });
        }

        // Upsert the tenant service link
        const tenantService = await prisma.tenantInPersonService.upsert({
            where: {
                tenantId_inPersonServiceId: {
                    tenantId: data.tenantId,
                    inPersonServiceId: data.inPersonServiceId
                }
            },
            update: {
                active: data.active
            },
            create: {
                tenantId: data.tenantId,
                inPersonServiceId: data.inPersonServiceId,
                active: data.active
            }
        });

        return res.status(200).json(tenantService);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ message: "Invalid data", errors: err.errors });
        }
        console.error("Error toggling tenant service", err);
        return res.status(500).json({ message: "Error" });
    }
});

export default router;
