import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// Lista obras públicas por tenant
router.get("/", async (req, res) => {
  try {
    const tenantId = req.query.tenantId as string | undefined;
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }
    const works = await prisma.work.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" }
    });
    return res.json(works);
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

// CRUD Admin
router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const user = req.user!;
    const tenantId = user.role === Role.MASTER ? (req.body.tenantId as string) : user.tenantId;
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }
    const data = req.body;

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
        title: data.title,
        artist: data.artist,
        year: data.year,
        // Fix category assignment: Ensure empty string becomes null
        categoryId: data.category && data.category !== "" ? data.category : null,

        room: data.room,
        floor: data.floor,
        description: data.description,
        imageUrl: data.imageUrl,
        audioUrl: data.audioUrl,
        librasUrl: data.librasUrl,
        videoUrl: data.videoUrl,

        // Geo-fencing - Cast to any to avoid stale type error
        ...({
          latitude: data.latitude ? parseFloat(data.latitude) : null,
          longitude: data.longitude ? parseFloat(data.longitude) : null,
          radius: data.radius ? parseInt(data.radius) : 5,
        } as any),

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

router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const work = await prisma.work.update({
      where: { id },
      data
    });
    return res.json(work);
  } catch (err) {
    console.error("Erro atualizar obra", err);
    return res.status(500).json({ message: "Erro ao atualizar obra" });
  }
});

router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.work.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    console.error("Erro excluir obra", err);
    return res.status(500).json({ message: "Erro ao excluir obra" });
  }
});

export default router;
