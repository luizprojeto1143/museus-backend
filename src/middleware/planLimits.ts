import { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma.js";

interface PlanLimits {
    maxActiveProjects: number;
    maxAccessibilityReqs: number;
    maxReportsPerMonth: number;
    maxAIAnalyses: number;
    maxWorks: number;
    maxEvents: number;
    maxChildTenants: number;
    maxUsers: number;
}

// Default limits for tenants without a plan
const DEFAULT_LIMITS: PlanLimits = {
    maxActiveProjects: 5,
    maxAccessibilityReqs: 2,
    maxReportsPerMonth: 5,
    maxAIAnalyses: 20,
    maxWorks: 20,
    maxEvents: 10,
    maxChildTenants: 0,
    maxUsers: 3
};

export async function getTenantLimits(tenantId: string): Promise<PlanLimits> {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { contractPlan: true }
    });

    if (!tenant || !tenant.contractPlan) {
        return DEFAULT_LIMITS;
    }

    return {
        maxActiveProjects: tenant.contractPlan.maxActiveProjects,
        maxAccessibilityReqs: tenant.contractPlan.maxAccessibilityReqs,
        maxReportsPerMonth: tenant.contractPlan.maxReportsPerMonth,
        maxAIAnalyses: tenant.contractPlan.maxAIAnalyses,
        maxWorks: tenant.contractPlan.maxWorks,
        maxEvents: tenant.contractPlan.maxEvents,
        maxChildTenants: tenant.contractPlan.maxChildTenants,
        maxUsers: tenant.contractPlan.maxUsers
    };
}

export async function checkLimit(
    tenantId: string,
    limitType: keyof PlanLimits,
    currentCount: number
): Promise<{ allowed: boolean; limit: number; current: number }> {
    const limits = await getTenantLimits(tenantId);
    const limit = limits[limitType];
    return {
        allowed: currentCount < limit,
        limit,
        current: currentCount
    };
}

// Middleware factory for checking specific limits
export function requirePlanLimit(limitType: keyof PlanLimits, countFn: (tenantId: string) => Promise<number>) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user;
            if (!user || !user.tenantId) {
                return res.status(400).json({ message: "Tenant não identificado" });
            }

            const currentCount = await countFn(user.tenantId);
            const check = await checkLimit(user.tenantId, limitType, currentCount);

            if (!check.allowed) {
                return res.status(403).json({
                    message: `Limite do plano atingido para ${limitType}`,
                    limit: check.limit,
                    current: check.current,
                    upgrade: "Entre em contato para upgrade do plano"
                });
            }

            next();
        } catch (err) {
            console.error("Error checking plan limit", err);
            next();
        }
    };
}

// Pre-built middleware for common limits
export const checkWorksLimit = requirePlanLimit(
    "maxWorks",
    async (tenantId) => prisma.work.count({ where: { tenantId } })
);

export const checkEventsLimit = requirePlanLimit(
    "maxEvents",
    async (tenantId) => prisma.event.count({ where: { tenantId } })
);

export const checkProjectsLimit = requirePlanLimit(
    "maxActiveProjects",
    async (tenantId) => prisma.culturalProject.count({
        where: { tenantId, status: { notIn: ["COMPLETED", "CANCELED"] } }
    })
);

export const checkChildTenantsLimit = requirePlanLimit(
    "maxChildTenants",
    async (tenantId) => prisma.tenant.count({ where: { parentId: tenantId } })
);
