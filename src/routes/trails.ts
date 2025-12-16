import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// Lista trilhas por tenant
router.get("/", async (req, res) => {
  try {
    const tenantId = req.query.tenantId as string | undefined;
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }
    const trails = await prisma.trail.findMany({
      where: { tenantId },
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
    const trail = await prisma.trail.findUnique({ where: { id } });
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

// CRUD Admin
router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const user = req.user!;
    const tenantId = user.role === Role.MASTER ? (req.body.tenantId as string) : user.tenantId;
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }
    interface TrailBody {
      title: string;
      description?: string;
      duration?: number;
      workIds?: string[];
      tenantId?: string;
      categoryId?: string;
    }

    const { title, description, duration, workIds, categoryId } = req.body as TrailBody;
    const trail = await prisma.trail.create({
      data: {
        title,
        description,
        duration,
        workIds: workIds || [],
        categoryId: categoryId && categoryId !== "" ? categoryId : null,
        tenantId
      }
    });
    return res.status(201).json(trail);
  } catch (err) {
    console.error("Erro criar trilha", err);
    return res.status(500).json({ message: "Erro ao criar trilha" });
  }
});

router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, duration, workIds } = req.body as {
      title: string;
      description?: string;
      duration?: number;
      workIds?: string[];
    };
    const trail = await prisma.trail.update({
      where: { id },
      data: {
        title,
        description,
        duration,
        workIds: workIds || []
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
    await prisma.trail.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    console.error("Erro excluir trilha", err);
    return res.status(500).json({ message: "Erro ao excluir trilha" });
  }
});

export default router;
