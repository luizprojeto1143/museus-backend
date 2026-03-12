import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { z } from "zod";
import { createAuditLog } from "./audit.js";

const router = Router();

// Lista trilhas por tenant
router.get("/", async (req, res) => {
  try {
    const tenantId = req.query.tenantId as string | undefined;
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }
    const trails = await prisma.trail.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: "desc" }
    });
    return res.json(trails);
  } catch (err) {
    console.error("Erro listar trilhas", err);
    return res.status(500).json({ message: "Erro ao listar trilhas" });
  }
});

// Detalhe trilha
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const trail = await prisma.trail.findFirst({ 
      where: { id, deletedAt: null } 
    });
    if (!trail) {
      return res.status(404).json({ message: "Trilha não encontrada" });
    }
    // carregar obras desta trilha
    const works = await prisma.work.findMany({
      where: { id: { in: trail.workIds } }
    });
    return res.json({ ...trail, works });
  } catch (err) {
    console.error("Erro detalhar trilha", err);
    return res.status(500).json({ message: "Erro ao detalhar trilha" });
  }
});

// GENERATOR: Smart Route (Public)
router.post("/generate", async (req, res) => {
  try {
    const { tenantId, minutes } = req.body;

    if (!tenantId || !minutes) {
      return res.status(400).json({ message: "TenantId e minutes são obrigatórios" });
    }

    // 1. Logic: 10 minutes per work (conservative estimate)
    // 30 min = 3 works
    // 60 min = 6 works
    const maxWorks = Math.floor(Number(minutes) / 10);
    if (maxWorks < 1) return res.status(400).json({ message: "Tempo insuficiente para visitar obras." });

    // 2. Fetch active works
    const works = await prisma.work.findMany({
      where: { tenantId, published: true },
      select: { id: true, title: true, imageUrl: true }
    });

    if (works.length === 0) {
      return res.status(404).json({ message: "Nenhuma obra disponível para gerar roteiro." });
    }

    // 3. Shuffle & Slice (Simple "AI" - Random Walk)
    const shuffled = works.sort(() => 0.5 - Math.random());
    const selectedWorks = shuffled.slice(0, maxWorks);
    const workIds = selectedWorks.map(w => w.id);

    // 4. Create ephemeral trail object (not saved to DB to avoid pollution, or saved as temporary?)
    // For now, return as a trail-like object that frontend can render
    const smartTrail = {
      id: "smart-generated-" + Date.now(),
      title: `Roteiro de ${minutes} Minutos`,
      description: `Um roteiro personalizado gerado para o seu tempo disponível. Inclui ${selectedWorks.length} obras principais.`,
      duration: Number(minutes),
      workIds,
      works: selectedWorks,
      isGenerated: true // flag for frontend
    };

    return res.json(smartTrail);

  } catch (err) {
    console.error("Erro gerar roteiro", err);
    return res.status(500).json({ message: "Erro ao gerar roteiro" });
  }
});

// SAVE: Persist a Smart Route
router.post("/save", authMiddleware, async (req, res) => {
  try {
    const { title, description, workIds, duration, tenantId } = req.body;
    const user = req.user!;

    if (!workIds || !Array.isArray(workIds) || workIds.length === 0) {
      return res.status(400).json({ message: "Roteiro deve ter obras." });
    }

    // Create the trail
    const trail = await prisma.trail.create({
      data: {
        title: title || `Roteiro Personalizado`,
        description: description || "Gerado automaticamente pela IA",
        duration: Number(duration) || 0,
        workIds: workIds,
        tenantId: tenantId,
        categoryId: null, // Custom category or null
        // We might want to mark this as "Private" or "User Generated" in the future
        // For now, it's just a trail that shows up in their list (logic to be handled by frontend filtering or a new 'ownerId' field if necessary)
      }
    });

    // Optimization: In a real app, we might associate this trail with the User so only they see it.
    // For now, assuming it's a shared persistent route or we rely on frontend local storage for "my trails" referencing this ID.
    // Ideally schema should have `ownerId`. 

    // TODO: Future Persistence - Add ownerId to Trail model for private routes.

    return res.status(201).json(trail);

  } catch (err) {
    console.error("Erro salvar roteiro", err);
    return res.status(500).json({ message: "Erro ao salvar roteiro" });
  }
});

// CRUD Admin
router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const user = req.user!;
    const tenantId = user.role === Role.MASTER ? (req.body.tenantId as string) : user.tenantId;
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
        tenantId
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

router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    // IDOR Protection: Verify resource belongs to user's tenant
    const whereClause = user.role === Role.MASTER
      ? { id }
      : { id, tenantId: user.tenantId as string };
    const existing = await prisma.trail.findFirst({ where: whereClause });
    if (!existing) {
      return res.status(404).json({ message: "Trilha não encontrada" });
    }

    const { title, description, duration, workIds, imageUrl, audioUrl, videoUrl, active } = req.body as {
      title: string;
      description?: string;
      duration?: number;
      workIds?: string[];
      imageUrl?: string;
      audioUrl?: string;
      videoUrl?: string;
      active?: boolean;
    };
    // Storage Cleanup: Delete old files if they were replaced
    const { deleteFromStorage } = await import("./upload.js");
    if (imageUrl && imageUrl !== existing.imageUrl && existing.imageUrl) deleteFromStorage(existing.imageUrl).catch(console.error);
    if (audioUrl && audioUrl !== existing.audioUrl && existing.audioUrl) deleteFromStorage(existing.audioUrl).catch(console.error);
    if (videoUrl && videoUrl !== existing.videoUrl && existing.videoUrl) deleteFromStorage(existing.videoUrl).catch(console.error);

    const trail = await prisma.trail.update({
      where: { id },
      data: {
        title,
        description,
        duration,
        workIds: workIds || [],
        imageUrl,
        audioUrl,
        videoUrl,
        active
      }
    });
    return res.json(trail);
  } catch (err) {
    console.error("Erro atualizar trilha", err);
    return res.status(500).json({ message: "Erro ao atualizar trilha" });
  }
});

router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const { hard } = req.query;
    const user = req.user!;

    // IDOR Protection: Verify resource belongs to user's tenant
    const whereClause = user.role === Role.MASTER
      ? { id }
      : { id, tenantId: user.tenantId as string };
    const existing = await prisma.trail.findFirst({ where: whereClause });
    if (!existing) {
      return res.status(404).json({ message: "Trilha não encontrada" });
    }

    const isMaster = user.role === Role.MASTER;
    const shouldHardDelete = isMaster && hard === "true";

    // C-02: Check for impact before deletion
    const visitCount = await prisma.visitorVisit.count({ where: { trailId: id } });
    const favoriteCount = await prisma.favorite.count({ where: { trailId: id } });

    if ((visitCount > 0 || favoriteCount > 0) && !shouldHardDelete) {
      return res.status(400).json({ 
        message: `Não é possível excluir esta trilha pois ela já possui ${visitCount} visitas registradas e foi favoritada por ${favoriteCount} pessoas. Considere desativá-la em vez de excluí-la.` 
      });
    }

    if (shouldHardDelete) {
      // Permanent Delete (Hard)
      await prisma.trail.delete({ where: { id } });

      // Cleanup files from R2
      const { deleteFromStorage } = await import("./upload.js");
      if (existing.imageUrl) deleteFromStorage(existing.imageUrl).catch(console.error);
      if (existing.audioUrl) deleteFromStorage(existing.audioUrl).catch(console.error);
      if (existing.videoUrl) deleteFromStorage(existing.videoUrl).catch(console.error);
      
      console.log(`[Trail] Hard deleted trail ${id} by MASTER`);
    } else {
      // Soft Delete
      await prisma.trail.update({
        where: { id },
        data: { deletedAt: new Date(), active: false }
      });
      console.log(`[Trail] Soft deleted trail ${id}`);
    }

    await createAuditLog(
      shouldHardDelete ? 'HARD_DELETE' : 'SOFT_DELETE',
      'Trail',
      id,
      user.id,
      user.email,
      existing.tenantId,
      existing,
      null,
      req
    );

    return res.status(204).send();
  } catch (err) {
    console.error("Erro excluir trilha", err);
    return res.status(500).json({ message: "Erro ao excluir trilha" });
  }
});

export default router;
