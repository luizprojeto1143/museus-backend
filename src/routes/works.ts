import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role, QRType } from "@prisma/client";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { createWorkSchema, updateWorkSchema } from "../schemas/work.schema.js";
import { WorkService } from "../services/work.js";
import { createAuditLog } from "./audit.js";

const router = Router();

import { softAuthMiddleware } from "../middleware/auth.js";

// Lista obras públicas por tenant (com paginação)
router.get("/", softAuthMiddleware, async (req, res) => {
  try {
    const tenantId = req.query.tenantId as string | undefined;
    const equipamentoId = req.query.equipamentoId as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }

    // Default filter: Published and not deleted
    let whereClause: any = { tenantId, published: true, deletedAt: null };
    if (equipamentoId) whereClause.equipamentoId = equipamentoId;

    // If authenticated and authorized, allow seeing unpublished works
    if (req.user) {
      const isMaster = req.user.role === Role.MASTER;
      const isTenantAdmin = (req.user.role === Role.ADMIN || req.user.role === Role.PRODUCER) && req.user.tenantId === tenantId;

      if (isMaster || isTenantAdmin) {
        delete whereClause.published; // Remove published filter
      }
    }

    const [works, total] = await Promise.all([
      prisma.work.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit
      }),
      prisma.work.count({ where: whereClause })
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
    console.error("Erro ao buscar obras:", err);
    return res.status(500).json({
      message: "Erro ao buscar obras",
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

// Detalhe da obra
router.get("/:id", softAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const work = await prisma.work.findFirst({ 
      where: { id, deletedAt: null } 
    });

    if (!work) {
      return res.status(404).json({ message: "Obra não encontrada" });
    }

    // Security Check: Visibility
    // If NOT published AND NOT (Admin/Master/Producer of this tenant), block access.
    if (!work.published) {
      const user = req.user;
      const isMaster = user?.role === Role.MASTER;
      const isTenantAdmin = user && (user.role === Role.ADMIN || user.role === Role.PRODUCER) && user.tenantId === work.tenantId;

      if (!isMaster && !isTenantAdmin) {
        return res.status(404).json({ message: "Obra não encontrada ou indisponível" }); // Return 404 to hide existence
      }
    }

    return res.json(work);
  } catch (err: any) {
    console.error("Erro ao buscar obra:", err);
    return res.status(500).json({
      message: "Erro ao buscar obra",
      error: err instanceof Error ? err.message : String(err)
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
      imageUrl, audioUrl, librasUrl, videoUrl,
      latitude, longitude, radius,
      technique, period, medium, dimensions,
      code, // Dialer code from frontend
      equipamentoId
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

    // Check if code is already in use
    if (code) {
      const existingCode = await prisma.qRCode.findUnique({ where: { code } });
      if (existingCode) {
        return res.status(400).json({ message: "Este código já está em uso em outra obra ou recurso." });
      }
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
        technique,
        period,
        medium,
        dimensions,
        latitude: latitude ? Number(latitude) : null,
        longitude: longitude ? Number(longitude) : null,
        radius: radius ? Number(radius) : 5,
        tenantId,
        equipamentoId: equipamentoId || null,
      }
    });

    // Create entry in QRCode table for the dialer code
    if (code) {
      await prisma.qRCode.create({
        data: {
          code,
          type: QRType.WORK,
          referenceId: work.id,
          title: work.title,
          tenantId
        }
      });
    }

    return res.status(201).json(work);
  } catch (err: any) {
    console.error("Erro criar obra:", err);
    if (err.code === 'P2002' && err.meta?.target?.includes('code')) {
      return res.status(400).json({ message: "Este código já está em uso." });
    }
    if (err.code === 'P2003') {
      return res.status(400).json({ message: "Categoria fornecida é inválida ou não existe." });
    }
    return res.status(500).json({ 
      message: "Erro ao criar obra",
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

// Update Work
router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), validate(updateWorkSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const data = req.body;

    // IDOR Protection: Verify resource belongs to user's tenant
    const whereClause = user.role === Role.MASTER
      ? { id }
      : { id, tenantId: user.tenantId as string };
    const existing = await prisma.work.findFirst({
      where: whereClause,
      include: {
        tenant: true
      }
    });
    if (!existing) {
      return res.status(404).json({ message: "Obra não encontrada" });
    }

    // Handle code update/creation
    if (data.code !== undefined) {
      const newCode = data.code;
      const currentQR = await prisma.qRCode.findFirst({
        where: { referenceId: id, type: QRType.WORK }
      });

      if (newCode) {
        // Check if code is used by SOMEONE ELSE
        const codeInUse = await prisma.qRCode.findUnique({ where: { code: newCode } });
        if (codeInUse && codeInUse.referenceId !== id) {
          return res.status(400).json({ message: "Este código já está em uso em outra obra." });
        }

        if (currentQR) {
          if (currentQR.code !== newCode) {
            await prisma.qRCode.update({
              where: { id: currentQR.id },
              data: { code: newCode, title: data.title || existing.title }
            });
          } else if (data.title && data.title !== existing.title) {
            await prisma.qRCode.update({
              where: { id: currentQR.id },
              data: { title: data.title }
            });
          }
        } else {
          // Create new QR record
          await prisma.qRCode.create({
            data: {
              code: newCode,
              type: QRType.WORK,
              referenceId: id,
              title: data.title || existing.title,
              tenantId: existing.tenantId
            }
          });
        }
      } else if (currentQR) {
        // If code was removed (newCode is null/empty)
        await prisma.qRCode.delete({ where: { id: currentQR.id } });
      }
    }

    // Build safe update object with known Prisma types
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
      technique: data.technique,
      period: data.period,
      medium: data.medium,
      dimensions: data.dimensions,
      published: data.published,
    };

    if (data.metadata !== undefined) {
      updateData.metadata = data.metadata;
    }

    if (data.radius !== undefined) {
      updateData.radius = parseInt(data.radius) || 5;
    }

    // Handle category relation
    if (data.category !== undefined || data.categoryId !== undefined) {
      const catId = data.categoryId || data.category;
      updateData.categoryId = catId && catId !== "" ? catId : null;
    }

    // Handle optional geofencing if provided
    if (data.latitude) updateData.latitude = parseFloat(data.latitude);
    if (data.longitude) updateData.longitude = parseFloat(data.longitude);

    // Storage Cleanup: Delete old files if they were replaced
    const { deleteFromStorage } = await import("./upload.js");
    if (data.imageUrl && data.imageUrl !== existing.imageUrl && existing.imageUrl) deleteFromStorage(existing.imageUrl).catch(console.error);
    if (data.audioUrl && data.audioUrl !== existing.audioUrl && existing.audioUrl) deleteFromStorage(existing.audioUrl).catch(console.error);
    if (data.librasUrl && data.librasUrl !== existing.librasUrl && existing.librasUrl) deleteFromStorage(existing.librasUrl).catch(console.error);
    if (data.videoUrl && data.videoUrl !== existing.videoUrl && existing.videoUrl) deleteFromStorage(existing.videoUrl).catch(console.error);

    const work = await prisma.work.update({
      where: { id },
      data: {
        ...updateData,
        equipamentoId: data.equipamentoId !== undefined ? data.equipamentoId : undefined
      }
    });
    return res.json(work);
  } catch (err: any) {
    console.error(`Erro ao atualizar obra ID: ${req.params.id}`, err);
    if (err.code === 'P2002' && err.meta?.target?.includes('code')) {
      return res.status(400).json({ message: "Este código já está em uso." });
    }
    return res.status(500).json({
      message: "Erro ao atualizar obra",
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), async (req, res) => {
  try {
    const { id } = req.params;
    const { hard } = req.query; // ?hard=true for MASTER permanent delete
    const user = req.user!;

    // IDOR Protection: Verify resource belongs to user's tenant
    const whereClause = user.role === Role.MASTER
      ? { id }
      : { id, tenantId: user.tenantId as string };
    const work = await prisma.work.findFirst({ where: whereClause });

    if (!work) return res.status(404).json({ message: "Obra não encontrada" });

    const isMaster = user.role === Role.MASTER;
    const shouldHardDelete = isMaster && hard === "true";

    if (shouldHardDelete) {
      // Permanent Delete (Hard)
      // 1. Delete associated QR code
      await prisma.qRCode.deleteMany({
        where: { referenceId: id, type: QRType.WORK }
      });

      // 2. Delete from DB
      await prisma.work.delete({ where: { id } });

      // 3. Cleanup files from R2
      const { deleteFromStorage } = await import("./upload.js");
      if (work.imageUrl) deleteFromStorage(work.imageUrl).catch(console.error);
      if (work.audioUrl) deleteFromStorage(work.audioUrl).catch(console.error);
      if (work.librasUrl) deleteFromStorage(work.librasUrl).catch(console.error);
      if (work.videoUrl) deleteFromStorage(work.videoUrl).catch(console.error);
      
      console.log(`[Work] Hard deleted work ${id} by MASTER`);
    } else {
      // Soft Delete
      await prisma.work.update({
        where: { id },
        data: { deletedAt: new Date(), published: false }
      });
      console.log(`[Work] Soft deleted work ${id}`);
    }

    await createAuditLog(
      shouldHardDelete ? 'HARD_DELETE' : 'SOFT_DELETE',
      'Work',
      id,
      user.id,
      user.email,
      work.tenantId,
      work,
      null,
      req
    );

    return res.status(204).send();
  } catch (err) {
    console.error("Erro ao excluir obra:", err);
    return res.status(500).json({ 
      message: "Erro ao excluir obra",
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

export default router;
