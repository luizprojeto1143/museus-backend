import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware, requireRole, requirePermission } from "../../middleware/auth.js";
import { Role, QRType } from "@prisma/client";
import { z } from "zod";
import { validate } from "../../middleware/validate.js";
import { createWorkSchema, updateWorkSchema } from "../../schemas/work.schema.js";
import { WorkService } from "../../services/work.js";
import { assertTenantOwnership } from "../../utils/ownership.js";
import { createAuditLog } from "../governance/audit.js";
import { resolveCatalogTenantId } from "../../utils/catalogTenant.js";

const router = Router();

import { softAuthMiddleware } from "../../middleware/auth.js";

async function validateWorkRelations(tenantId: string, relations: { categoryId?: string | null; equipamentoId?: string | null }) {
  if (relations.categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: relations.categoryId, tenantId }
    });
    if (!category) {
      throw Object.assign(new Error("Categoria nao encontrada neste tenant"), { status: 400 });
    }
  }

  if (relations.equipamentoId) {
    const equipamento = await prisma.equipamentoCultural.findFirst({
      where: { id: relations.equipamentoId, tenantId }
    });
    if (!equipamento) {
      throw Object.assign(new Error("Equipamento nao encontrado neste tenant"), { status: 400 });
    }
  }
}

// Lista obras públicas por tenant (com paginação)
router.get("/", softAuthMiddleware, async (req, res) => {
  try {
    const catalogTenant = await resolveCatalogTenantId(req);
    if (!catalogTenant.ok) {
      return res.status(catalogTenant.status).json({ message: catalogTenant.message });
    }
    const tenantId = catalogTenant.tenantId;
    const equipamentoId = req.query.equipamentoId as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;
    const search = (req.query.search as string | undefined)?.trim();

    // Default filter: Published and not deleted
    const whereClause: any = { tenantId, published: true, deletedAt: null };
    if (equipamentoId) whereClause.equipamentoId = equipamentoId;

    // L2 Fix: Add vestigeActive filter if requested
    if (req.query.vestigeActive === "true") {
      whereClause.vestigeActive = true;
    } else if (req.query.vestigeActive === "false") {
      whereClause.vestigeActive = false;
    }

    // Text search across title, artist, description
    if (search) {
      whereClause.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { artist: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    // If authenticated and authorized, allow seeing unpublished works
    if (req.user) {
      const isMaster = req.user.role === Role.MASTER;
      const isTenantAdmin = (req.user.role === Role.ADMIN || req.user.role === Role.PRODUCER || req.user.role === Role.COLLABORATOR) && req.user.tenantId === tenantId;

      if (isMaster || isTenantAdmin) {
        delete whereClause.published; // Remove published filter
      }
    }

    const [works, total] = await Promise.all([
      prisma.work.findMany({
        where: whereClause,
        include: { category: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit
      }),
      prisma.work.count({ where: whereClause })
    ]);

    // Manual QR Code fetch
    const workIds = works.map(w => w.id);
    const qrcodes = await prisma.qRCode.findMany({
      where: { referenceId: { in: workIds }, type: QRType.WORK }
    });

    const dataWithQR = works.map(w => ({
      ...w,
      qrCode: qrcodes.find(qr => qr.referenceId === w.id)
    }));

    return res.json({
      data: dataWithQR,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Erro ao buscar obras:", err);
    return res.status(500).json({ message: "Erro ao buscar obras" });
  }
});

// Detalhe da obra
router.get("/:id", softAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || req.query.tenantId;

    const work = await prisma.work.findFirst({ 
      where: { 
        id, 
        tenantId: tenantId ? String(tenantId) : undefined,
        deletedAt: null 
      },
      include: { 
        category: true,
        collectibleCards: true
      }
    });

    if (!work) {
      return res.status(404).json({ message: "Obra não encontrada" });
    }

    const qrCode = await prisma.qRCode.findFirst({
      where: { referenceId: id, type: QRType.WORK }
    });

    if (!work.published) {
      const user = req.user;
      const isMaster = user?.role === Role.MASTER;
      const isTenantAdmin = user && (user.role === Role.ADMIN || user.role === Role.PRODUCER || user.role === Role.COLLABORATOR) && user.tenantId === work.tenantId;

      if (!isMaster && !isTenantAdmin) {
        return res.status(404).json({ message: "Obra não encontrada ou indisponível" });
      }
    }
    return res.json({ ...work, qrCode });
  } catch (err: any) {
    console.error("Erro ao buscar obra:", err);
    return res.status(500).json({ message: "Erro ao buscar obra" });
  }
});

// Obras relacionadas
router.get("/:id/related", async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId, visitorEmail } = req.query;

    const relatedWorks = await WorkService.getRelatedWorks(
      id,
      tenantId as string,
      visitorEmail as string
    );

    return res.json(relatedWorks);

  } catch (err: any) {
    if (err.message === "Obra não encontrada") {
      return res.status(404).json({ message: "Obra não encontrada" });
    }
    console.error("Erro ao buscar obras relacionadas", err);
    return res.json([]);
  }
});

export default router;
