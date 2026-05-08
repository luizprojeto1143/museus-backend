import type { Request, Response, NextFunction } from "express";

/**
 * Global middleware to extract tenantId from various sources:
 * 1. X-Tenant-ID Header (Preferred for PWAs/Apps)
 * 2. Query string (?tenantId=...)
 * 3. Request body
 */
export function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  const headerTenant = req.headers["x-tenant-id"];
  const queryTenant = req.query.tenantId;
  const bodyTenant = req.body?.tenantId;

  const resolvedTenantId = headerTenant || queryTenant || bodyTenant;

  if (resolvedTenantId) {
    // Attach to request for easy access in controllers
    (req as any).tenantId = String(resolvedTenantId);
  }

  next();
}
