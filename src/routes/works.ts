import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { createWorkSchema, updateWorkSchema } from "../schemas/work.schema.js";
import { WorkService } from "../services/work.js";

const router = Router();

// Lista obras públicas por tenant (com paginação)
router.get("/", async (req, res) => {
  try {
    const tenantId = req.query.tenantId as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }

    const [works, total] = await Promise.all([
      prisma.work.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit
      }),
      prisma.work.count({ where: { tenantId } })
    ]);

    return res.json({
      data: works,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Erro listar obras", err);
    return res.status(500).json({ message: "Erro ao listar obras" });
  }
});

// Detalhe da obra
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const work = await prisma.work.findUnique({ where: { id } });
    if (!work) {
      return res.status(404).json({ message: "Obra não encontrada" });
    }
    return res.json(work);
  } catch (err: any) {
    console.error(`Erro detalhar obra ID: ${req.params.id}`, {
      message: err.message,
      code: err.code,
      meta: err.meta,
      stack: err.stack
    });
    return res.status(500).json({
      message: "Erro ao buscar obra",
      debug: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
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

// CRUD Admin
router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), validate(createWorkSchema), async (req, res) => {
  try {
    const user = req.user!;
    const tenantId = user.role === Role.MASTER ? (req.body.tenantId as string) : user.tenantId;
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }

    const {
      title, artist, year, categoryId,
      room, floor, description,
      imageUrl, audioUrl, librasUrl, videoUrl, audioDescriptionUrl,
      latitude, longitude, radius,
      qrCode, isHighlight, isAccessible, order
    } = req.body;

    // Check Plan Limits
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ message: "Tenant não encontrado" });

    const currentWorks = await prisma.work.count({ where: { tenantId } });
    if (currentWorks >= tenant.maxWorks) {
      return res.status(403).json({
        message: `Limite de obras atingido para o plano ${tenant.plan}. Atualize seu plano para continuar.`
      });
    }

    const work = await prisma.work.create({
      data: {
        title,
        artist,
        year,
        categoryId: categoryId || null,
        room,
        floor,
        description,
        imageUrl,
        audioUrl,
        librasUrl,
        videoUrl,
        latitude: latitude ? Number(latitude) : null,
        longitude: longitude ? Number(longitude) : null,
        radius: radius ? Number(radius) : 5,
        tenantId
      }
    });
    return res.status(201).json(work);
  } catch (err: any) {
    console.error("Erro criar obra", err);
    if (err.code === 'P2003') {
      return res.status(400).json({ message: "Categoria fornecida é inválida ou não existe." });
    }
    return res.status(500).json({ message: "Erro ao criar obra" });
  }
});

// Update Work
router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), validate(updateWorkSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    // Build safe update object with known Prisma types
    // Using explicit fields instead of `any` cast
    const updateData: Record<string, any> = {
      title: data.title,
      artist: data.artist,
      year: data.year,
      room: data.room,
      floor: data.floor,
      description: data.description,
      imageUrl: data.imageUrl,
      audioUrl: data.audioUrl,
      librasUrl: data.librasUrl,
      videoUrl: data.videoUrl,
      published: data.published,
    };

    if (data.radius !== undefined) {
      updateData.radius = parseInt(data.radius) || 5;
    }

    // Handle category relation
    if (data.category !== undefined) {
      updateData.categoryId = data.category && data.category !== "" ? data.category : null;
    }

    // Handle optional geofencing if provided
    if (data.latitude) updateData.latitude = parseFloat(data.latitude);
    if (data.longitude) updateData.longitude = parseFloat(data.longitude);

    const work = await prisma.work.update({
      where: { id },
      data: updateData
    });
    return res.json(work);
  } catch (err: any) {
    console.error(`Erro atualizar obra ID: ${req.params.id}`, err);
    return res.status(500).json({
      message: "Erro ao atualizar obra",
      debug: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch work to get file URLs
    const work = await prisma.work.findUnique({ where: { id } });

    if (work) {
      await prisma.work.delete({ where: { id } });

      // Cleanup files in background (don't block response)
      const { deleteFromStorage } = await import("./upload.js");
      if (work.imageUrl) deleteFromStorage(work.imageUrl);
      if (work.audioUrl) deleteFromStorage(work.audioUrl);
      if (work.librasUrl) deleteFromStorage(work.librasUrl);
      if (work.videoUrl) deleteFromStorage(work.videoUrl);
    }

    return res.status(204).send();
  } catch (err) {
    console.error("Erro excluir obra", err);
    return res.status(500).json({ message: "Erro ao excluir obra" });
  }
});

export default router;
