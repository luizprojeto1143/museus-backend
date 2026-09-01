import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../../prisma.js";
import { authMiddleware, softAuthMiddleware, requireRole, requirePermission } from "../../middleware/auth.js";
import { resolveCatalogTenantId } from "../../utils/catalogTenant.js";
import { Role, PlatformFeeSource } from "@prisma/client";
import { getPlatformFee } from "../../services/fee.service.js";
import { sendCertificateEmail, generateCertificateBuffer } from "../../services/email.js";
import { z } from "zod";
import { createAuditLog } from "../governance/audit.js";
import { validate } from "../../middleware/validate.js";
import { createEventSchema, updateEventSchema } from "../../schemas/event.schema.js";
import { stripe, stripeService } from "../../services/stripeService.js";
import { dispatchEvent, backgroundQueue } from "../../infrastructure/queue/bullmq.setup.js";
import { assertTenantOwnership } from "../../utils/ownership.js";
import { deliverTenantWebhooks } from "../../services/outboundWebhook.service.js";

const router = Router();

async function validateEventRelations(tenantId: string, relations: { categoryId?: string | null; equipamentoId?: string | null }) {
  if (relations.categoryId) {
    const category = await prisma.category.findFirst({ where: { id: relations.categoryId, tenantId } });
    if (!category) throw Object.assign(new Error("Categoria nao encontrada neste tenant"), { status: 400 });
  }
  if (relations.equipamentoId) {
    const equipamento = await prisma.equipamentoCultural.findFirst({ where: { id: relations.equipamentoId, tenantId } });
    if (!equipamento) throw Object.assign(new Error("Equipamento nao encontrado neste tenant"), { status: 400 });
  }
}

router.get("/", softAuthMiddleware, async (req, res) => {
  try {
    const { visibility, discovery, status, equipamentoId, cityId } = req.query;
    let tenantId = (req as any).tenantId || req.query.tenantId;
    const user = req.user;
    const isMaster = user?.role === Role.MASTER;
    const whereClause: import("@prisma/client").Prisma.EventWhereInput = { deletedAt: null };
    if (discovery === "true") {
      whereClause.visibility = "PUBLIC";
      whereClause.status = "PUBLISHED";
      whereClause.startDate = { gte: new Date() };
      if (equipamentoId) whereClause.equipamentoId = equipamentoId as string;
      if (cityId) whereClause.tenant = { parentId: cityId as string };
    } else {
      const catalogTenant = await resolveCatalogTenantId(req);
      if (!catalogTenant.ok) {
        return res.status(catalogTenant.status).json({
          message: catalogTenant.message === "tenantId é obrigatório"
            ? "tenantId é obrigatório (ou use ?discovery=true)"
            : catalogTenant.message
        });
      }
      tenantId = catalogTenant.tenantId;
      const isTenantAdminResolved = Boolean(user && (user.role === Role.ADMIN || user.role === Role.PRODUCER || user.role === Role.COLLABORATOR) && user.tenantId === tenantId);
      const hasPrivilegeResolved = Boolean(isMaster || isTenantAdminResolved);
      whereClause.OR = [{ tenantId: tenantId as string }, { tenant: { parentId: tenantId as string } }];
      if (equipamentoId) whereClause.equipamentoId = equipamentoId as string;
      if (hasPrivilegeResolved) {
        if (status) whereClause.status = status as string;
        if (visibility) whereClause.visibility = visibility as string;
      } else {
        whereClause.status = "PUBLISHED";
        whereClause.visibility = "PUBLIC";
        if (status && status !== "PUBLISHED") {
          return res.json({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });
        }
      }
    }
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where: whereClause,
        include: { tenant: { select: { id: true, name: true, slug: true, type: true } } },
        orderBy: { startDate: "asc" },
        take: limit,
        skip
      }),
      prisma.event.count({ where: whereClause })
    ]);
    return res.json({ data: events, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error("Erro listar eventos", err);
    return res.status(500).json({ message: "Erro ao listar eventos" });
  }
});
