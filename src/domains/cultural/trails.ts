import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { Role } from "@prisma/client";
import { formLimiter } from "../../middleware/rateLimiter.js";
import { z } from "zod";
import { createAuditLog } from "../governance/audit.js";
import { resolveCatalogTenantId } from "../../utils/catalogTenant.js";

const router = Router();

async function validateTrailWorks(tenantId: string, workIds: string[]) {
  if (!workIds.length) return;
  const works = await prisma.work.findMany({
    where: { id: { in: workIds }, tenantId, published: true, deletedAt: null },
    select: { id: true }
  });
  if (works.length !== new Set(workIds).size) {
    throw Object.assign(new Error("Uma ou mais obras nao pertencem a este tenant ou nao estao publicadas"), { status: 400 });
  }
}

router.get("/", async (req, res) => {
  try {
    const catalogTenant = await resolveCatalogTenantId(req);
    if (!catalogTenant.ok) {
      return res.status(catalogTenant.status).json({ message: catalogTenant.message });
    }
    const tenantId = catalogTenant.tenantId;
    const equipamentoId = req.query.equipamentoId as string;
    const ownerId = undefined;
    const where: any = { tenantId, deletedAt: null };
    if (equipamentoId) where.equipamentoId = equipamentoId;
    if (ownerId) {
      where.ownerId = ownerId;
    } else {
      where.ownerId = null;
    }
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;
    const [trails, total] = await Promise.all([
      prisma.trail.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip }),
      prisma.trail.count({ where })
    ]);
    return res.json({ data: trails, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error("Erro listar trilhas", err);
    return res.status(500).json({ message: "Erro ao listar trilhas" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const catalogTenant = await resolveCatalogTenantId(req);
    if (!catalogTenant.ok) {
      return res.status(catalogTenant.status).json({ message: catalogTenant.message });
    }
    const tenantId = catalogTenant.tenantId;
    const trail = await prisma.trail.findFirst({ where: { id, tenantId: String(tenantId), deletedAt: null } });
    if (!trail) {
      return res.status(404).json({ message: "Trilha não encontrada" });
    }
    const works = await prisma.work.findMany({
      where: { id: { in: trail.workIds }, tenantId: String(tenantId), published: true, deletedAt: null }
    });
    return res.json({ ...trail, works });
  } catch (err) {
    console.error("Erro detalhar trilha", err);
    return res.status(500).json({ message: "Erro ao detalhar trilha" });
  }
});

router.post("/generate", formLimiter, async (req, res) => {
  try {
    const { tenantId, minutes } = req.body;
    if (!tenantId || !minutes) {
      return res.status(400).json({ message: "TenantId e minutes são obrigatórios" });
    }
    const maxWorks = Math.floor(Number(minutes) / 10);
    if (maxWorks < 1) return res.status(400).json({ message: "Tempo insuficiente para visitar obras." });
    const works = await prisma.work.findMany({
      where: { tenantId, published: true },
      select: { id: true, title: true, imageUrl: true }
    });
    if (works.length === 0) {
      return res.status(404).json({ message: "Nenhuma obra disponível para gerar roteiro." });
    }
    const shuffled = works.sort(() => 0.5 - Math.random());
    const selectedWorks = shuffled.slice(0, maxWorks);
    const workIds = selectedWorks.map(w => w.id);
    const smartTrail = {
      id: "smart-generated-" + Date.now(),
      title: `Roteiro de ${minutes} Minutos`,
      description: `Um roteiro personalizado gerado para o seu tempo disponível. Inclui ${selectedWorks.length} obras principais.`,
      duration: Number(minutes),
      workIds,
      works: selectedWorks,
      isGenerated: true
    };
    return res.json(smartTrail);
  } catch (err) {
    console.error("Erro gerar roteiro", err);
    return res.status(500).json({ message: "Erro ao gerar roteiro" });
  }
});

router.post("/save", authMiddleware, async (req, res) => {
  try {
    const { title, description, workIds, duration } = req.body;
    const user = req.user!;
    const tenantId = user.role === Role.MASTER ? req.body.tenantId : user.tenantId;
    if (!workIds || !Array.isArray(workIds) || workIds.length === 0) {
      return res.status(400).json({ message: "Roteiro deve ter obras." });
    }
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId obrigatorio" });
    }
    await validateTrailWorks(tenantId, workIds);
    const ownerId = user.role === Role.VISITOR ? user.id : null;
    const trail = await prisma.trail.create({
      data: {
        title: title || "Roteiro Personalizado",
        description: description || "Gerado automaticamente pela IA",
        duration: Number(duration) || 0,
        workIds,
        tenantId,
        ownerId,
        categoryId: null,
      }
    });
    return res.status(201).json(trail);
  } catch (err) {
    console.error("Erro salvar roteiro", err);
    return res.status(500).json({ message: "Erro ao salvar roteiro" });
  }
});

router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), async (req, res) => {
  try {
    const user = req.user!;
    const tenantId = user.role === Role.MASTER ? (req.body.tenantId as string) : user.tenantId;
    const { equipamentoId } = req.body;
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }
    const trailSchema = z.object({
      title: z.string().min(1, "Título é obrigatório"),
      description: z.string().optional(),
      duration: z.number().int().positive().optional(),
      workIds: z.array(z.string()).optional().default([]),
      categoryId: z.string().optional().nullable(),
      imageUrl: z.string().optional().nullable(),
      audioUrl: z.string().optional().nullable(),
      videoUrl: z.string().optional().nullable(),
      active: z.boolean().optional().default(true)
    });
    const data = trailSchema.parse(req.body);
    await validateTrailWorks(tenantId, data.workIds);
    const trail = await prisma.trail.create({
      data: {
        title: data.title,
        description: data.description,
        duration: data.duration,
        workIds: data.workIds,
        categoryId: data.categoryId && data.categoryId !== "" ? data.categoryId : null,
        imageUrl: data.imageUrl,
        audioUrl: data.audioUrl,
        videoUrl: data.videoUrl,
        active: data.active,
        tenantId,
        equipamentoId: equipamentoId || null
      }
    });
    return res.status(201).json(trail);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
    }
    console.error("Erro criar trilha", err);
    return res.status(500).json({ message: "Erro ao criar trilha" });
  }
});

router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const whereClause = user.role === Role.MASTER ? { id } : { id, tenantId: user.tenantId as string };
    const existing = await prisma.trail.findFirst({ where: whereClause });
    if (!existing) {
      return res.status(404).json({ message: "Trilha não encontrada" });
    }
    const { title, description, duration, workIds, imageUrl, audioUrl, videoUrl, active } = req.body as {
      title: string; description?: string; duration?: number; workIds?: string[];
      imageUrl?: string; audioUrl?: string; videoUrl?: string; active?: boolean;
    };
    if (workIds !== undefined) {
      await validateTrailWorks(existing.tenantId, workIds);
    }
    const { deleteFromStorage } = await import("../../routes/upload.js");
    if (imageUrl && imageUrl !== existing.imageUrl && existing.imageUrl) deleteFromStorage(existing.imageUrl).catch(console.error);
    if (audioUrl && audioUrl !== existing.audioUrl && existing.audioUrl) deleteFromStorage(existing.audioUrl).catch(console.error);
    if (videoUrl && videoUrl !== existing.videoUrl && existing.videoUrl) deleteFromStorage(existing.videoUrl).catch(console.error);
    const trail = await prisma.trail.update({
      where: { id },
      data: { title, description, duration, workIds: workIds !== undefined ? workIds : undefined, imageUrl, audioUrl, videoUrl, active }
    });
    return res.json(trail);
  } catch (err) {
    console.error("Erro atualizar trilha", err);
    return res.status(500).json({ message: "Erro ao atualizar trilha" });
  }
});

router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), async (req, res) => {
  try {
    const { id } = req.params;
    const { hard } = req.query;
    const user = req.user!;
    const whereClause = user.role === Role.MASTER ? { id } : { id, tenantId: user.tenantId as string };
    const existing = await prisma.trail.findFirst({ where: whereClause });
    if (!existing) {
      return res.status(404).json({ message: "Trilha não encontrada" });
    }
    const isMaster = user.role === Role.MASTER;
    const shouldHardDelete = isMaster && hard === "true";
    const visitCount = await prisma.visitorVisit.count({ where: { trailId: id } });
    const favoriteCount = await prisma.favorite.count({ where: { trailId: id } });
    if ((visitCount > 0 || favoriteCount > 0) && !shouldHardDelete) {
      return res.status(400).json({
        message: `Não é possível excluir esta trilha pois ela já possui ${visitCount} visitas registradas e foi favoritada por ${favoriteCount} pessoas. Considere desativá-la em vez de excluí-la.`
      });
    }
    if (shouldHardDelete) {
      await prisma.trail.delete({ where: { id } });
      const { deleteFromStorage } = await import("../../routes/upload.js");
      if (existing.imageUrl) deleteFromStorage(existing.imageUrl).catch(console.error);
      if (existing.audioUrl) deleteFromStorage(existing.audioUrl).catch(console.error);
      if (existing.videoUrl) deleteFromStorage(existing.videoUrl).catch(console.error);
      console.log(`[Trail] Hard deleted trail ${id} by MASTER`);
    } else {
      await prisma.trail.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
      console.log(`[Trail] Soft deleted trail ${id}`);
    }
    await createAuditLog(shouldHardDelete ? "HARD_DELETE" : "SOFT_DELETE", "Trail", id, user.id, user.email, existing.tenantId, existing, null, req);
    return res.status(204).send();
  } catch (err) {
    console.error("Erro excluir trilha", err);
    return res.status(500).json({ message: "Erro ao excluir trilha" });
  }
});

export default router;
