import { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma.js";

// Cost estimates per operation (in USD)
const AI_COSTS = {
    CHAT_COMPLETION: { tokensEstimate: 500, costPer1000Tokens: 0.002 },
    IMAGE_ANALYSIS: { tokensEstimate: 1000, costPer1000Tokens: 0.01 },
    AUDIO_TRANSCRIPTION: { tokensEstimate: 100, costPer1000Tokens: 0.006 },
    PERSONA_GENERATION: { tokensEstimate: 200, costPer1000Tokens: 0.002 },
    WORK_DESCRIPTION: { tokensEstimate: 300, costPer1000Tokens: 0.002 },
    PROJECT_ANALYSIS: { tokensEstimate: 2000, costPer1000Tokens: 0.002 }
};

type AIOperationType = keyof typeof AI_COSTS;

/**
 * Middleware to track AI usage for a tenant
 */
export async function trackAIUsage(
    tenantId: string,
    operationType: AIOperationType,
    actualTokens?: number
) {
    try {
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();

        const costInfo = AI_COSTS[operationType];
        const tokens = actualTokens || costInfo.tokensEstimate;
        const cost = (tokens / 1000) * costInfo.costPer1000Tokens;

        // Upsert usage record for current month
        await prisma.aIUsage.upsert({
            where: {
                tenantId_month_year: { tenantId, month, year }
            },
            update: {
                analysesCount: { increment: 1 },
                tokensUsed: { increment: tokens },
                estimatedCost: { increment: cost }
            },
            create: {
                tenantId,
                month,
                year,
                analysesCount: 1,
                tokensUsed: tokens,
                estimatedCost: cost
            }
        });

        return { tokens, cost };
    } catch (err) {
        console.error("Error tracking AI usage:", err);
        return null;
    }
}

/**
 * Check if tenant has exceeded AI usage limits
 */
export async function checkAILimit(tenantId: string): Promise<{
    allowed: boolean;
    current: number;
    limit: number;
    remaining: number;
    percentUsed: number;
}> {
    try {
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();

        // Get tenant's plan limits
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            include: { contractPlan: true }
        });

        const limit = tenant?.contractPlan?.maxAIAnalyses || 100; // Default limit

        // Get current usage
        const usage = await prisma.aIUsage.findUnique({
            where: {
                tenantId_month_year: { tenantId, month, year }
            }
        });

        const current = usage?.analysesCount || 0;
        const remaining = Math.max(0, limit - current);
        const percentUsed = Math.round((current / limit) * 100);

        return {
            allowed: current < limit,
            current,
            limit,
            remaining,
            percentUsed
        };
    } catch (err) {
        console.error("Error checking AI limit:", err);
        return { allowed: true, current: 0, limit: 100, remaining: 100, percentUsed: 0 };
    }
}

/**
 * Middleware factory for AI limit enforcement
 */
export function requireAILimit() {
    return async (req: Request, res: Response, next: NextFunction) => {
        const user = req.user;
        if (!user?.tenantId) {
            return res.status(401).json({ message: "Não autenticado" });
        }

        const check = await checkAILimit(user.tenantId);

        if (!check.allowed) {
            return res.status(403).json({
                message: "Limite mensal de análises IA atingido",
                current: check.current,
                limit: check.limit,
                upgradeHint: "Considere fazer upgrade do seu plano para mais análises"
            });
        }

        // Store usage info for later tracking
        (req as any).aiUsageInfo = check;

        next();
    };
}

/**
 * Get AI usage summary for a tenant
 */
export async function getAIUsageSummary(tenantId: string, months: number = 6) {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

    const usage = await prisma.aIUsage.findMany({
        where: {
            tenantId,
            OR: [
                { year: { gt: startDate.getFullYear() } },
                {
                    year: startDate.getFullYear(),
                    month: { gte: startDate.getMonth() + 1 }
                }
            ]
        },
        orderBy: [{ year: "asc" }, { month: "asc" }]
    });

    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { contractPlan: true }
    });

    const monthlyLimit = tenant?.contractPlan?.maxAIAnalyses || 100;

    // Current month stats
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const currentUsage = usage.find(u => u.month === currentMonth && u.year === currentYear);

    return {
        current: {
            month: currentMonth,
            year: currentYear,
            analysesCount: currentUsage?.analysesCount || 0,
            tokensUsed: currentUsage?.tokensUsed || 0,
            estimatedCost: Number(currentUsage?.estimatedCost || 0),
            limit: monthlyLimit,
            percentUsed: currentUsage
                ? Math.round((currentUsage.analysesCount / monthlyLimit) * 100)
                : 0
        },
        history: usage.map(u => ({
            month: u.month,
            year: u.year,
            label: `${u.year}-${String(u.month).padStart(2, "0")}`,
            analysesCount: u.analysesCount,
            tokensUsed: u.tokensUsed,
            estimatedCost: Number(u.estimatedCost)
        })),
        totals: {
            totalAnalyses: usage.reduce((sum, u) => sum + u.analysesCount, 0),
            totalTokens: usage.reduce((sum, u) => sum + u.tokensUsed, 0),
            totalCost: usage.reduce((sum, u) => sum + Number(u.estimatedCost), 0)
        }
    };
}
