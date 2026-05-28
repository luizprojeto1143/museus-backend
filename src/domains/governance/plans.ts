import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { Role } from "@prisma/client";
import { z } from "zod";
import { createAuditLog } from "../governance/audit.js";

const router = Router();

// ========== MASTER ONLY - Contract Plans Management ==========

const planSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    maxActiveProjects: z.number().int().min(0).default(10),
    maxAccessibilityReqs: z.number().int().min(0).default(5),
    maxReportsPerMonth: z.number().int().min(0).default(10),
    maxAIAnalyses: z.number().int().min(0).default(100),
    maxWorks: z.number().int().min(0).default(50),
    maxEvents: z.number().int().min(0).default(20),
    maxChildTenants: z.number().int().min(0).default(0),
    maxUsers: z.number().int().min(0).default(5),
    aiTier: z.enum(["BASIC", "CONTINUOUS", "ADVANCED"]).default("BASIC"),
    slaTier: z.enum(["STANDARD", "EXTENDED", "DEDICATED"]).default("STANDARD"),
    supportResponseHours: z.number().int().min(1).default(48),
    monthlyPrice: z.number().optional(),
    hasExecutiveReports: z.boolean().default(false),
    hasLegalCompliance: z.boolean().default(false),
    hasAPIAccess: z.boolean().default(false),
    hasWhiteLabel: z.boolean().default(false)
});

// List all plans
router.get("/", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
    try {
        const plans = await prisma.contractPlan.findMany({
            orderBy: { monthlyPrice: "asc" },
            include: { _count: { select: { tenants: true } } }
        });
        return res.json(plans);
    } catch (err) {
        console.error("Error listing plans", err);
        return res.status(500).json({ message: "Erro ao listar planos" });
    }
});

// Get plan by ID
router.get("/:id", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const plan = await prisma.contractPlan.findUnique({
            where: { id },
            include: { tenants: { select: { id: true, name: true, slug: true } } }
        });
        if (!plan) return res.status(404).json({ message: "Plano não encontrado" });
        return res.json(plan);
    } catch (err) {
        console.error("Error fetching plan", err);
        return res.status(500).json({ message: "Erro ao buscar plano" });
    }
});

// Create plan
router.post("/", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
    try {
        const data = planSchema.parse(req.body);
        const plan = await prisma.contractPlan.create({ data: data as any });
        
        await createAuditLog(
            'CREATE',
            'ContractPlan',
            plan.id,
            req.user!.id,
            req.user!.email,
            'master',
            null,
            plan,
            req
        );

        return res.status(201).json(plan);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
        }
        console.error("Error creating plan", err);
        return res.status(500).json({ message: "Erro ao criar plano" });
    }
});

// Update plan
router.put("/:id", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const data = planSchema.partial().parse(req.body);

        const existing = await prisma.contractPlan.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ message: "Plano não encontrado" });

        const plan = await prisma.contractPlan.update({ where: { id }, data: data as any });

        await createAuditLog(
            'UPDATE',
            'ContractPlan',
            id,
            req.user!.id,
            req.user!.email,
            'master',
            existing,
            plan,
            req
        );

        return res.json(plan);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
        }
        console.error("Error updating plan", err);
        return res.status(500).json({ message: "Erro ao atualizar plano" });
    }
});

// Delete plan
router.delete("/:id", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;

        // Check if any tenants are using this plan
        const tenantsUsing = await prisma.tenant.count({ where: { planId: id } });
        if (tenantsUsing > 0) {
            return res.status(400).json({
                message: `Não é possível excluir: ${tenantsUsing} tenant(s) usando este plano`
            });
        }

        const oldPlan = await prisma.contractPlan.findUnique({ where: { id } });
        await prisma.contractPlan.delete({ where: { id } });

        await createAuditLog(
            'DELETE',
            'ContractPlan',
            id,
            req.user!.id,
            req.user!.email,
            'master',
            oldPlan,
            null,
            req
        );

        return res.status(204).send();
    } catch (err) {
        console.error("Error deleting plan", err);
        return res.status(500).json({ message: "Erro ao excluir plano" });
    }
});

// Assign plan to tenant
router.post("/:planId/assign/:tenantId", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
    try {
        const { planId, tenantId } = req.params;

        const plan = await prisma.contractPlan.findUnique({ where: { id: planId } });
        if (!plan) return res.status(404).json({ message: "Plano não encontrado" });

        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) return res.status(404).json({ message: "Tenant não encontrado" });

        await prisma.tenant.update({
            where: { id: tenantId },
            data: { planId }
        });

        return res.json({ message: `Plano ${plan.name} atribuído a ${tenant.name}` });
    } catch (err) {
        console.error("Error assigning plan", err);
        return res.status(500).json({ message: "Erro ao atribuir plano" });
    }
});

export default router;
