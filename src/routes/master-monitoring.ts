import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role, SystemErrorSeverity, SystemErrorSource, AuditAction, SecurityEventType, SecurityEventSeverity, IntegrationProvider, JobExecutionStatus } from "@prisma/client";
import { createSystemError } from "../services/error-log.service.js";

const router = Router();

// ==========================================
// 1. PUBLIC ENDPOINT FOR FRONTEND ERRORS
// ==========================================

// POST /monitoring/frontend-error
router.post("/frontend-error", async (req: Request, res: Response) => {
  try {
    const { message, stack, path, metadata } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Mensagem de erro obrigatória." });
    }

    const tenantId = (req as any).tenantId || req.headers["x-tenant-id"] || null;
    const userId = req.user?.id || null;

    await createSystemError({
      tenantId: typeof tenantId === "string" ? tenantId : null,
      userId,
      source: SystemErrorSource.FRONTEND,
      severity: SystemErrorSeverity.MEDIUM,
      message,
      stack,
      path,
      statusCode: null,
      metadata
    });

    return res.json({ status: "success" });
  } catch (error) {
    console.error("Erro ao reportar erro do frontend:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

// ==========================================
// 2. MASTER MONITORING ENDPOINTS
// ==========================================

// Helper for pagination query parse
function getPagination(req: Request) {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
  const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || "20"), 10)));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// GET /master/monitoring/overview
router.get("/overview", authMiddleware, requireRole([Role.MASTER]), async (req: Request, res: Response) => {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const errors24h = await prisma.systemErrorLog.count({
      where: { createdAt: { gte: oneDayAgo } }
    });

    const criticalErrors24h = await prisma.systemErrorLog.count({
      where: {
        createdAt: { gte: oneDayAgo },
        severity: SystemErrorSeverity.CRITICAL
      }
    });

    const securityEvents24h = await prisma.securityEventLog.count({
      where: { createdAt: { gte: oneDayAgo } }
    });

    const failedIntegrations24h = await prisma.integrationLog.count({
      where: {
        createdAt: { gte: oneDayAgo },
        status: "FAILED"
      }
    });

    const apiRequests = await prisma.apiRequestLog.findMany({
      where: { createdAt: { gte: oneDayAgo } },
      select: { durationMs: true }
    });

    const avgApiDurationMs = apiRequests.length > 0
      ? Math.round(apiRequests.reduce((acc, r) => acc + r.durationMs, 0) / apiRequests.length)
      : 0;

    const slowRequests24h = apiRequests.filter(r => r.durationMs > 1500).length;

    const auditEvents24h = await prisma.auditLog.count({
      where: { createdAt: { gte: oneDayAgo } }
    });

    // Tenants ativos nas últimas 24h (que tiveram logs de requests ou auditorias)
    const activeTenantsRaw = await prisma.apiRequestLog.findMany({
      where: { createdAt: { gte: oneDayAgo } },
      select: { tenantId: true },
      distinct: ["tenantId"]
    });
    const activeTenants24h = activeTenantsRaw.filter(t => t.tenantId !== null).length;

    return res.json({
      errors24h,
      criticalErrors24h,
      securityEvents24h,
      failedIntegrations24h,
      avgApiDurationMs,
      slowRequests24h,
      auditEvents24h,
      activeTenants24h
    });
  } catch (error) {
    console.error("Erro no overview de monitoramento:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

// GET /master/monitoring/errors
router.get("/errors", authMiddleware, requireRole([Role.MASTER]), async (req: Request, res: Response) => {
  try {
    const { skip, limit, page } = getPagination(req);
    const { tenantId, severity, source, dateFrom, dateTo, search } = req.query;

    const where: any = {};
    if (tenantId) where.tenantId = String(tenantId);
    if (severity) where.severity = severity as SystemErrorSeverity;
    if (source) where.source = source as SystemErrorSource;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(String(dateFrom));
      if (dateTo) where.createdAt.lte = new Date(String(dateTo));
    }
    if (search) {
      where.OR = [
        { message: { contains: String(search), mode: "insensitive" } },
        { path: { contains: String(search), mode: "insensitive" } }
      ];
    }

    const [total, data] = await Promise.all([
      prisma.systemErrorLog.count({ where }),
      prisma.systemErrorLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          tenant: { select: { name: true } },
          user: { select: { name: true, email: true } }
        }
      })
    ]);

    return res.json({ total, page, limit, data });
  } catch (error) {
    return res.status(500).json({ error: "Erro ao carregar logs de erro." });
  }
});

// GET /master/monitoring/audit-logs
router.get("/audit-logs", authMiddleware, requireRole([Role.MASTER]), async (req: Request, res: Response) => {
  try {
    const { skip, limit, page } = getPagination(req);
    const { tenantId, userId, action, entityType, entityId, dateFrom, dateTo } = req.query;

    const where: any = {};
    if (tenantId) where.tenantId = String(tenantId);
    if (userId) where.userId = String(userId);
    if (action) where.action = action as AuditAction;
    if (entityType) where.entityType = String(entityType);
    if (entityId) where.entityId = String(entityId);
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(String(dateFrom));
      if (dateTo) where.createdAt.lte = new Date(String(dateTo));
    }

    const [total, data] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          tenant: { select: { name: true } },
          user: { select: { name: true, email: true } }
        }
      })
    ]);

    return res.json({ total, page, limit, data });
  } catch (error) {
    return res.status(500).json({ error: "Erro ao carregar auditorias." });
  }
});

// GET /master/monitoring/security-events
router.get("/security-events", authMiddleware, requireRole([Role.MASTER]), async (req: Request, res: Response) => {
  try {
    const { skip, limit, page } = getPagination(req);
    const { tenantId, userId, type, severity, dateFrom, dateTo } = req.query;

    const where: any = {};
    if (tenantId) where.tenantId = String(tenantId);
    if (userId) where.userId = String(userId);
    if (type) where.type = type as SecurityEventType;
    if (severity) where.severity = severity as SecurityEventSeverity;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(String(dateFrom));
      if (dateTo) where.createdAt.lte = new Date(String(dateTo));
    }

    const [total, data] = await Promise.all([
      prisma.securityEventLog.count({ where }),
      prisma.securityEventLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          tenant: { select: { name: true } },
          user: { select: { name: true, email: true } }
        }
      })
    ]);

    return res.json({ total, page, limit, data });
  } catch (error) {
    return res.status(500).json({ error: "Erro ao carregar eventos de segurança." });
  }
});

// GET /master/monitoring/api-requests
router.get("/api-requests", authMiddleware, requireRole([Role.MASTER]), async (req: Request, res: Response) => {
  try {
    const { skip, limit, page } = getPagination(req);
    const { tenantId, statusCode, path, dateFrom, dateTo } = req.query;

    const where: any = {};
    if (tenantId) where.tenantId = String(tenantId);
    if (statusCode) where.statusCode = parseInt(String(statusCode), 10);
    if (path) where.path = { contains: String(path), mode: "insensitive" };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(String(dateFrom));
      if (dateTo) where.createdAt.lte = new Date(String(dateTo));
    }

    const [total, data] = await Promise.all([
      prisma.apiRequestLog.count({ where }),
      prisma.apiRequestLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit
      })
    ]);

    return res.json({ total, page, limit, data });
  } catch (error) {
    return res.status(500).json({ error: "Erro ao buscar logs de requisição." });
  }
});

// GET /master/monitoring/integrations
router.get("/integrations", authMiddleware, requireRole([Role.MASTER]), async (req: Request, res: Response) => {
  try {
    const { skip, limit, page } = getPagination(req);
    const { tenantId, provider, status, dateFrom, dateTo } = req.query;

    const where: any = {};
    if (tenantId) where.tenantId = String(tenantId);
    if (provider) where.provider = provider as IntegrationProvider;
    if (status) where.status = status as any;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(String(dateFrom));
      if (dateTo) where.createdAt.lte = new Date(String(dateTo));
    }

    const [total, data] = await Promise.all([
      prisma.integrationLog.count({ where }),
      prisma.integrationLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit
      })
    ]);

    return res.json({ total, page, limit, data });
  } catch (error) {
    return res.status(500).json({ error: "Erro ao buscar logs de integração." });
  }
});

// GET /master/monitoring/jobs
router.get("/jobs", authMiddleware, requireRole([Role.MASTER]), async (req: Request, res: Response) => {
  try {
    const { skip, limit, page } = getPagination(req);
    const { jobName, status, dateFrom, dateTo } = req.query;

    const where: any = {};
    if (jobName) where.jobName = { contains: String(jobName), mode: "insensitive" };
    if (status) where.status = status as JobExecutionStatus;
    if (dateFrom || dateTo) {
      where.startedAt = {};
      if (dateFrom) where.startedAt.gte = new Date(String(dateFrom));
      if (dateTo) where.startedAt.lte = new Date(String(dateTo));
    }

    const [total, data] = await Promise.all([
      prisma.jobExecutionLog.count({ where }),
      prisma.jobExecutionLog.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip,
        take: limit
      })
    ]);

    return res.json({ total, page, limit, data });
  } catch (error) {
    return res.status(500).json({ error: "Erro ao buscar logs de jobs." });
  }
});

// GET /master/monitoring/tenants/:tenantId/activity
router.get("/tenants/:tenantId/activity", authMiddleware, requireRole([Role.MASTER]), async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;

    const [recentErrors, recentSecurity, recentAudit, recentRequests] = await Promise.all([
      prisma.systemErrorLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 10
      }),
      prisma.securityEventLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 10
      }),
      prisma.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { user: { select: { name: true, email: true } } }
      }),
      prisma.apiRequestLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 10
      })
    ]);

    return res.json({
      recentErrors,
      recentSecurity,
      recentAudit,
      recentRequests
    });
  } catch (error) {
    return res.status(500).json({ error: "Erro ao buscar atividade do tenant." });
  }
});

export default router;
export { router as masterMonitoringRouter };
