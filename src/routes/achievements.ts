import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { tenantId } = req.query as { tenantId?: string };
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }

    const achievements = await prisma.achievement.findMany({
      where: { tenantId }
    });

    return res.json(achievements);
  } catch (err) {
    console.error("Erro ao listar conquistas", err);
    return res.status(500).json({ message: "Erro ao listar conquistas" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const achievement = await prisma.achievement.findUnique({ where: { id } });

    if (!achievement) {
      return res.status(404).json({ message: "Conquista não encontrada" });
    }

    return res.json(achievement);
  } catch (err) {
    console.error("Erro ao buscar conquista", err);
    return res.status(500).json({ message: "Erro ao buscar conquista" });
  }
});

router.post("/", authMiddleware, requireRole(["ADMIN", "MASTER"]), async (req, res) => {
  try {
    const { code, title, description, tenantId } = req.body as {
      code?: string;
      title?: string;
      description?: string;
      tenantId?: string;
    };

    if (!code || !title || !tenantId) {
      return res.status(400).json({ message: "code, title e tenantId são obrigatórios" });
    }

    const achievement = await prisma.achievement.create({
      data: {
        code,
        title,
        description: description || null,
        tenantId
      }
    });

    return res.status(201).json(achievement);
  } catch (err) {
    console.error("Erro ao criar conquista", err);
    return res.status(500).json({ message: "Erro ao criar conquista" });
  }
});

router.put("/:id", authMiddleware, requireRole(["ADMIN", "MASTER"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { code, title, description } = req.body as {
      code?: string;
      title?: string;
      description?: string;
    };

    const achievement = await prisma.achievement.update({
      where: { id },
      data: {
        ...(code && { code }),
        ...(title && { title }),
        ...(description !== undefined && { description })
      }
    });

    return res.json(achievement);
  } catch (err) {
    console.error("Erro ao atualizar conquista", err);
    return res.status(500).json({ message: "Erro ao atualizar conquista" });
  }
});

router.delete("/:id", authMiddleware, requireRole(["ADMIN", "MASTER"]), async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.achievement.delete({ where: { id } });
    return res.json({ message: "Conquista excluída com sucesso" });
  } catch (err) {
    console.error("Erro ao excluir conquista", err);
    return res.status(500).json({ message: "Erro ao excluir conquista" });
  }
});

router.post("/unlock", async (req, res) => {
  try {
    const { visitorId, achievementId } = req.body as {
      visitorId?: string;
      achievementId?: string;
    };

    if (!visitorId || !achievementId) {
      return res.status(400).json({ message: "visitorId e achievementId são obrigatórios" });
    }

    const existing = await prisma.visitorAchievement.findFirst({
      where: { visitorId, achievementId }
    });

    if (existing) {
      return res.status(400).json({ message: "Conquista já desbloqueada" });
    }

    const unlocked = await prisma.visitorAchievement.create({
      data: {
        visitorId,
        achievementId
      },
      include: {
        achievement: true
      }
    });

    return res.status(201).json(unlocked);
  } catch (err) {
    console.error("Erro ao desbloquear conquista", err);
    return res.status(500).json({ message: "Erro ao desbloquear conquista" });
  }
});

router.get("/visitor/:visitorId", async (req, res) => {
  try {
    const { visitorId } = req.params;

    const achievements = await prisma.visitorAchievement.findMany({
      where: { visitorId },
      include: {
        achievement: true
      },
      orderBy: { unlockedAt: "desc" }
    });

    return res.json(achievements);
  } catch (err) {
    console.error("Erro ao listar conquistas do visitante", err);
    return res.status(500).json({ message: "Erro ao listar conquistas" });
  }
});

export default router;
