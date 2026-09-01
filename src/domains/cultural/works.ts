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

    const whereClause: any = { tenantId, published: true, deletedAt: null };
    if (equipamentoId) whereClause.equipamentoId = equipamentoId;

    if (req.query.vestigeActive === "true") {
      whereClause.vestigeActive = true;
    } else if (req.query.vestigeActive === "false") {
      whereClause.vestigeActive = false;
    }

    if (search) {
      whereClause.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { artist: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    if (req.user) {
      const isMaster = req.user.role === Role.MASTER;
      const isTenantAdmin = (req.user.role === Role.ADMIN || req.user.role === Role.PRODUCER || req.user.role === Role.COLLABORATOR) && req.user.tenantId === tenantId;
      if (isMaster || isTenantAdmin) {
        delete whereClause.published;
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
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error("Erro ao buscar obras:", err);
    return res.status(500).json({ message: "Erro ao buscar obras" });
  }
});

router.get("/:id", softAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || req.query.tenantId;
    const work = await prisma.work.findFirst({
      where: { id, tenantId: tenantId ? String(tenantId) : undefined, deletedAt: null },
      include: { category: true, collectibleCards: true }
    });
    if (!work) {
      return res.status(404).json({ message: "Obra não encontrada" });
    }
    const qrCode = await prisma.qRCode.findFirst({ where: { referenceId: id, type: QRType.WORK } });
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

router.get("/:id/related", async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId, visitorEmail } = req.query;
    const relatedWorks = await WorkService.getRelatedWorks(id, tenantId as string, visitorEmail as string);
    return res.json(relatedWorks);
  } catch (err: any) {
    if (err.message === "Obra não encontrada") {
      return res.status(404).json({ message: "Obra não encontrada" });
    }
    console.error("Erro ao buscar obras relacionadas", err);
    return res.json([]);
  }
});

router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER, Role.COLLABORATOR]), requirePermission("manage_works"), validate(createWorkSchema), async (req, res) => {
  try {
    const user = req.user!;
    const tenantId = user.role === Role.MASTER ? (req.body.tenantId as string) : user.tenantId;
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }
    const {
      title, artist, year, categoryId, room, floor, description,
      imageUrl, audioUrl, librasUrl, videoUrl, latitude, longitude, radius,
      technique, period, medium, dimensions, code, equipamentoId, metadata,
      lat, lng, captureRadiusM, vestigeActive, vestigeType, vestigeExpiresAt, vestigeImageUrl
    } = req.body;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ message: "Tenant não encontrado" });
    const currentWorks = await prisma.work.count({ where: { tenantId } });
    if (currentWorks >= tenant.maxWorks) {
      return res.status(403).json({ message: `Limite de obras atingido para o plano ${tenant.plan}. Atualize seu plano para continuar.` });
    }
    if (code) {
      const existingCode = await prisma.qRCode.findUnique({ where: { code } });
      if (existingCode) {
        return res.status(400).json({ message: "Este código já está em uso em outra obra ou recurso." });
      }
    }
    await validateWorkRelations(tenantId, { categoryId, equipamentoId });
    const work = await prisma.work.create({
      data: {
        title, artist, year, categoryId: categoryId || null, room, floor, description,
        imageUrl, audioUrl, librasUrl, videoUrl, technique, period, medium, dimensions,
        latitude: latitude !== undefined && latitude !== null && latitude !== "" ? Number(latitude) : null,
        longitude: longitude !== undefined && longitude !== null && longitude !== "" ? Number(longitude) : null,
        radius: radius ? Number(radius) : 5,
        lat: lat !== undefined && lat !== null && lat !== "" ? Number(lat) : null,
        lng: lng !== undefined && lng !== null && lng !== "" ? Number(lng) : null,
        captureRadiusM: captureRadiusM ? Number(captureRadiusM) : undefined,
        vestigeActive: vestigeActive === true || vestigeActive === "true",
        vestigeType: vestigeType || undefined,
        vestigeExpiresAt: vestigeExpiresAt ? new Date(vestigeExpiresAt) : null,
        vestigeImageUrl: vestigeImageUrl || null,
        tenantId, equipamentoId: equipamentoId || null, metadata: metadata || null,
      } as any
    });
    if (code) {
      await prisma.qRCode.create({
        data: { code, type: QRType.WORK, referenceId: work.id, title: work.title, tenantId }
      });
    }
    return res.status(201).json(work);
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("Erro criar obra:", err);
    if (err.code === "P2002" && err.meta?.target?.includes("code")) {
      return res.status(400).json({ message: "Este código já está em uso." });
    }
    if (err.code === "P2003") {
      return res.status(400).json({ message: "Categoria fornecida é inválida ou não existe." });
    }
    return res.status(500).json({ message: "Erro ao criar obra" });
  }
});

router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER, Role.COLLABORATOR]), requirePermission("manage_works"), validate(updateWorkSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const data = req.body;
    const existing = await assertTenantOwnership({ model: "work", id, user });
    if (data.code !== undefined) {
      const newCode = data.code;
      const currentQR = await prisma.qRCode.findFirst({ where: { referenceId: id, type: QRType.WORK } });
      if (newCode) {
        const codeInUse = await prisma.qRCode.findUnique({ where: { code: newCode } });
        if (codeInUse && codeInUse.referenceId !== id) {
          return res.status(400).json({ message: "Este código já está em uso em outra obra." });
        }
        if (currentQR) {
          if (currentQR.code !== newCode) {
            await prisma.qRCode.update({ where: { id: currentQR.id }, data: { code: newCode, title: data.title || existing.title } });
          } else if (data.title && data.title !== existing.title) {
            await prisma.qRCode.update({ where: { id: currentQR.id }, data: { title: data.title } });
          }
        } else {
          await prisma.qRCode.create({
            data: { code: newCode, type: QRType.WORK, referenceId: id, title: data.title || existing.title, tenantId: existing.tenantId }
          });
        }
      } else if (currentQR) {
        await prisma.qRCode.delete({ where: { id: currentQR.id } });
      }
    }
    const updateData: Record<string, any> = {
      title: data.title, artist: data.artist, year: data.year, room: data.room, floor: data.floor,
      description: data.description, imageUrl: data.imageUrl, audioUrl: data.audioUrl, librasUrl: data.librasUrl,
      videoUrl: data.videoUrl, technique: data.technique, period: data.period, medium: data.medium,
      dimensions: data.dimensions, published: data.published,
    };
    if (data.metadata !== undefined) updateData.metadata = data.metadata;
    await validateWorkRelations(existing.tenantId, { categoryId: data.categoryId || data.category, equipamentoId: data.equipamentoId });
    if (data.radius !== undefined) updateData.radius = parseInt(data.radius) || 5;
    if (data.category !== undefined || data.categoryId !== undefined) {
      const catId = data.categoryId || data.category;
      updateData.categoryId = catId && catId !== "" ? catId : null;
    }
    if (data.latitude !== undefined) updateData.latitude = data.latitude === "" || data.latitude === null ? null : parseFloat(data.latitude);
    if (data.longitude !== undefined) updateData.longitude = data.longitude === "" || data.longitude === null ? null : parseFloat(data.longitude);
    const { deleteFromStorage } = await import("../../routes/upload.js");
    if (data.imageUrl && data.imageUrl !== existing.imageUrl && existing.imageUrl) deleteFromStorage(existing.imageUrl).catch(console.error);
    if (data.audioUrl && data.audioUrl !== existing.audioUrl && existing.audioUrl) deleteFromStorage(existing.audioUrl).catch(console.error);
    if (data.librasUrl && data.librasUrl !== existing.librasUrl && existing.librasUrl) deleteFromStorage(existing.librasUrl).catch(console.error);
    if (data.videoUrl && data.videoUrl !== existing.videoUrl && existing.videoUrl) deleteFromStorage(existing.videoUrl).catch(console.error);
    const work = await prisma.work.update({
      where: { id },
      data: {
        ...updateData,
        lat: data.lat !== undefined ? (data.lat !== "" && data.lat !== null ? Number(data.lat) : null) : undefined,
        lng: data.lng !== undefined ? (data.lng !== "" && data.lng !== null ? Number(data.lng) : null) : undefined,
        captureRadiusM: data.captureRadiusM !== undefined ? (data.captureRadiusM ? Number(data.captureRadiusM) : null) : undefined,
        vestigeActive: data.vestigeActive !== undefined ? (data.vestigeActive === true || data.vestigeActive === "true") : undefined,
        vestigeType: data.vestigeType !== undefined ? (data.vestigeType || null) : undefined,
        vestigeExpiresAt: data.vestigeExpiresAt !== undefined ? (data.vestigeExpiresAt ? new Date(data.vestigeExpiresAt) : null) : undefined,
        vestigeImageUrl: data.vestigeImageUrl !== undefined ? (data.vestigeImageUrl || null) : undefined,
        equipamentoId: data.equipamentoId !== undefined ? data.equipamentoId : undefined
      } as any,
      include: { category: true }
    });
    const qrCode = await prisma.qRCode.findFirst({ where: { referenceId: id, type: QRType.WORK } });
    return res.json({ ...work, qrCode });
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(`Erro ao atualizar obra ID: ${req.params.id}`, err);
    if (err.code === "P2002" && err.meta?.target?.includes("code")) {
      return res.status(400).json({ message: "Este código já está em uso." });
    }
    return res.status(500).json({ message: "Erro ao atualizar obra" });
  }
});

router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER, Role.COLLABORATOR]), requirePermission("manage_works"), async (req, res) => {
  try {
    const { id } = req.params;
    const { hard } = req.query;
    const user = req.user!;
    const work = await assertTenantOwnership({ model: "work", id, user });
    const isMaster = user.role === Role.MASTER;
    const shouldHardDelete = isMaster && hard === "true";
    if (shouldHardDelete) {
      await prisma.qRCode.deleteMany({ where: { referenceId: id, type: QRType.WORK } });
      await prisma.work.delete({ where: { id } });
      const { deleteFromStorage } = await import("../../routes/upload.js");
      if (work.imageUrl) deleteFromStorage(work.imageUrl).catch(console.error);
      if (work.audioUrl) deleteFromStorage(work.audioUrl).catch(console.error);
      if (work.librasUrl) deleteFromStorage(work.librasUrl).catch(console.error);
      if (work.videoUrl) deleteFromStorage(work.videoUrl).catch(console.error);
      console.log(`[Work] Hard deleted work ${id} by MASTER`);
    } else {
      await prisma.qRCode.deleteMany({ where: { referenceId: id, type: QRType.WORK } });
      await prisma.work.update({ where: { id }, data: { deletedAt: new Date(), published: false } });
      console.log(`[Work] Soft deleted work ${id}`);
    }
    await createAuditLog(shouldHardDelete ? "HARD_DELETE" : "SOFT_DELETE", "Work", id, user.id, user.email, work.tenantId, work, null, req);
    return res.status(204).send();
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("Erro ao excluir obra:", err);
    return res.status(500).json({ message: "Erro ao excluir obra" });
  }
});

export default router;
