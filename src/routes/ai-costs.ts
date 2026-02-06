import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { getAIUsageSummary, checkAILimit } from "../middleware/aiUsage.js";

const router = Router();

// Get AI usage for current tenant
router.get("/usage", authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        if (!user.tenantId) {
            return res.status(400).json({ message: "Tenant obrigatório" });
        }

        const months = parseInt(req.query.months as string) || 6;
        const summary = await getAIUsageSummary(user.tenantId, months);

        return res.json(summary);
    } catch (err) {
        console.error("Error fetching AI usage", err);
        return res.status(500).json({ message: "Erro ao buscar uso de IA" });
    }
});

// Get AI usage for specific tenant (Master only)
router.get("/usage/:tenantId", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
    try {
        const { tenantId } = req.params;
        const months = parseInt(req.query.months as string) || 12;

        const summary = await getAIUsageSummary(tenantId, months);

        return res.json(summary);
    } catch (err) {
        console.error("Error fetching AI usage", err);
        return res.status(500).json({ message: "Erro ao buscar uso de IA" });
    }
});

// Get AI usage limits and status
router.get("/limits", authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        if (!user.tenantId) {
            return res.status(400).json({ message: "Tenant obrigatório" });
        }

        const limits = await checkAILimit(user.tenantId);

        // Get tier info
        const tenant = await prisma.tenant.findUnique({
            where: { id: user.tenantId },
            include: { contractPlan: true }
        });

        return res.json({
            ...limits,
            tier: tenant?.contractPlan?.aiTier || "BASIC",
            tierLabel: getTierLabel(tenant?.contractPlan?.aiTier || "BASIC")
        });
    } catch (err) {
        console.error("Error fetching AI limits", err);
        return res.status(500).json({ message: "Erro ao buscar limites de IA" });
    }
});

// Get global AI usage report (Master only)
router.get("/report", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
    try {
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();

        // Get all usage for current month
        const allUsage = await prisma.aIUsage.findMany({
            where: { month, year },
            include: {
                tenant: {
                    select: { id: true, name: true, slug: true }
                }
            },
            orderBy: { estimatedCost: "desc" }
        });

        const totalCost = allUsage.reduce((sum, u) => sum + Number(u.estimatedCost), 0);
        const totalAnalyses = allUsage.reduce((sum, u) => sum + u.analysesCount, 0);
        const totalTokens = allUsage.reduce((sum, u) => sum + u.tokensUsed, 0);

        // Top consumers
        const topConsumers = allUsage.slice(0, 10).map(u => ({
            tenantId: u.tenantId,
            tenantName: u.tenant.name,
            tenantSlug: u.tenant.slug,
            analysesCount: u.analysesCount,
            tokensUsed: u.tokensUsed,
            estimatedCost: Number(u.estimatedCost)
        }));

        // Tenants over 80% usage
        const tenantsWithLimits = await prisma.tenant.findMany({
            where: { contractPlan: { isNot: null } },
            include: { contractPlan: true }
        });

        const nearLimitTenants = [];
        for (const tenant of tenantsWithLimits) {
            const usage = allUsage.find(u => u.tenantId === tenant.id);
            if (usage && tenant.contractPlan) {
                const percentUsed = (usage.analysesCount / tenant.contractPlan.maxAIAnalyses) * 100;
                if (percentUsed >= 80) {
                    nearLimitTenants.push({
                        tenantId: tenant.id,
                        tenantName: tenant.name,
                        current: usage.analysesCount,
                        limit: tenant.contractPlan.maxAIAnalyses,
                        percentUsed: Math.round(percentUsed)
                    });
                }
            }
        }

        return res.json({
            period: { month, year },
            summary: {
                totalCost: Math.round(totalCost * 100) / 100,
                totalAnalyses,
                totalTokens,
                activeTenants: allUsage.length
            },
            topConsumers,
            nearLimitTenants
        });
    } catch (err) {
        console.error("Error generating AI report", err);
        return res.status(500).json({ message: "Erro ao gerar relatório de IA" });
    }
});

function getTierLabel(tier: string): string {
    switch (tier) {
        case "BASIC": return "Básico (sob demanda)";
        case "CONTINUOUS": return "Contínuo (prioridade média)";
        case "ADVANCED": return "Avançado (prioridade alta)";
        default: return tier;
    }
}

export default router;
