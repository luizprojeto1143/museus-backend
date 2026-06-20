import type { Request, Response, NextFunction } from "express";

/**
 * Middleware de Multitenancy Seguro.
 *
 * Para rotas AUTENTICADAS: tenantId vem sempre de req.user.tenantId (do JWT).
 * Apenas MASTER pode usar X-Tenant-ID / ?tenantId= para overrides pontuais.
 *
 * Para rotas PÚBLICAS (sem req.user): lê de header, query ou body normalmente.
 */
export function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;

  if (user) {
    // Rota autenticada: usa sempre o tenant do JWT
    if (user.role === 'MASTER') {
      // MASTER pode fazer override para gerenciar outros tenants
      const headerTenant = req.headers["x-tenant-id"];
      const queryTenant = req.query.tenantId;
      const bodyTenant = req.body?.tenantId;
      const override = headerTenant || queryTenant || bodyTenant;

      if (override &&
          override !== "undefined" &&
          override !== "null" &&
          override !== "") {
        (req as any).tenantId = String(override);
      } else {
        (req as any).tenantId = user.tenantId;
      }
    } else {
      // Qualquer outro role: usa SEMPRE o tenant do JWT, ignora header/query/body
      (req as any).tenantId = user.tenantId;
    }
  } else {
    // Rota pública (sem autenticação): lê de qualquer fonte
    const headerTenant = req.headers["x-tenant-id"];
    const queryTenant = req.query.tenantId;
    const bodyTenant = req.body?.tenantId;
    const resolvedTenantId = headerTenant || queryTenant || bodyTenant;

    if (resolvedTenantId &&
        resolvedTenantId !== "undefined" &&
        resolvedTenantId !== "null" &&
        resolvedTenantId !== "") {
      (req as any).tenantId = String(resolvedTenantId);
    }
  }

  next();
}
