import type { Request } from "express";
import { prisma } from "../prisma.js";

function cleanTenantValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = Array.isArray(value) ? String(value[0] ?? "") : String(value);
  const trimmed = text.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return null;
  return trimmed;
}

/**
 * Tenant do catálogo público: header e query precisam bater (se os dois vierem)
 * e o id tem que existir no banco. Header sozinho com UUID inventado não passa.
 */
export async function resolveCatalogTenantId(req: Request): Promise<
  { ok: true; tenantId: string } | { ok: false; status: number; message: string }
> {
  const header = cleanTenantValue(req.headers["x-tenant-id"]);
  const query = cleanTenantValue(req.query.tenantId);
  const fromMw = cleanTenantValue((req as any).tenantId);

  const provided = [header, query].filter((v): v is string => Boolean(v));
  const unique = [...new Set(provided)];

  if (unique.length > 1) {
    return { ok: false, status: 400, message: "x-tenant-id e tenantId não conferem" };
  }

  const tenantId = unique[0] || fromMw;
  if (!tenantId) {
    return { ok: false, status: 400, message: "tenantId é obrigatório" };
  }

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { id: true }
  });
  if (!tenant) {
    return { ok: false, status: 400, message: "tenant inválido" };
  }

  (req as any).tenantId = tenant.id;
  return { ok: true, tenantId: tenant.id };
}
