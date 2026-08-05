import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { dispatchEvent, backgroundQueue } from "../../infrastructure/queue/bullmq.setup.js";

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
    const { code, title, description, tenantId, xpReward, iconUrl, imageUrl, condition, autoTrigger, active } = req.body;

    if (!code || !title || !tenantId) {
      return res.status(400).json({ message: "code, title e tenantId são obrigatórios" });
    }

    const achievement = await prisma.achievement.create({
      data: {
        code,
        title,
        description: description || null,
        tenantId,
        xpReward: xpReward ? Number(xpReward) : 100,
        iconUrl: iconUrl || imageUrl || null,
        condition: condition || null,
        autoTrigger: autoTrigger ?? false,
        active: active ?? true
      }
    });

    return res.status(201).json(achievement);
  } catch (err) {
    console.error("Erro ao criar conquista", err);
    return res.status(500).json({ message: "Erro ao criar conquista" });
  }
});

const updateAchievement = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const { code, title, description, xpReward, iconUrl, imageUrl, condition, autoTrigger, active } = req.body;

    // IDOR Protection: Verify resource belongs to user's tenant
    const whereClause = user.role === "MASTER"
      ? { id }
      : { id, tenantId: user.tenantId as string };
    const existing = await prisma.achievement.findFirst({ where: whereClause });
    if (!existing) {
      return res.status(404).json({ message: "Conquista não encontrada" });
    }

    const achievement = await prisma.achievement.update({
      where: { id },
      data: {
        ...(code && { code }),
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(xpReward !== undefined && { xpReward: Number(xpReward) }),
        ...((iconUrl !== undefined || imageUrl !== undefined) && { iconUrl: iconUrl !== undefined ? iconUrl : imageUrl }),
        ...(condition !== undefined && { condition }),
        ...(autoTrigger !== undefined && { autoTrigger }),
        ...(active !== undefined && { active })
      }
    });

    return res.json(achievement);
  } catch (err) {
    console.error("Erro ao atualizar conquista", err);
    return res.status(500).json({ message: "Erro ao atualizar conquista" });
  }
};

router.put("/:id", authMiddleware, requireRole(["ADMIN", "MASTER"]), updateAchievement);
router.patch("/:id", authMiddleware, requireRole(["ADMIN", "MASTER"]), updateAchievement);

router.delete("/:id", authMiddleware, requireRole(["ADMIN", "MASTER"]), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    // IDOR Protection: Verify resource belongs to user's tenant
    const whereClause = user.role === "MASTER"
      ? { id }
      : { id, tenantId: user.tenantId as string };
    const existing = await prisma.achievement.findFirst({ where: whereClause });
    if (!existing) {
      return res.status(404).json({ message: "Conquista não encontrada" });
    }

    await prisma.achievement.delete({ where: { id } });
    return res.json({ message: "Conquista excluída com sucesso" });
  } catch (err) {
    console.error("Erro ao excluir conquista", err);
    return res.status(500).json({ message: "Erro ao excluir conquista" });
  }
});

// SECURITY: Achievement unlock requires authentication
router.post("/unlock", authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    let { visitorId } = req.body as { visitorId?: string };
    const { achievementId } = req.body as { achievementId?: string };

    if (!achievementId) {
      return res.status(400).json({ message: "achievementId é obrigatório" });
    }

    // SECURITY: IDOR Protection 🛡️
    // If user is NOT Admin/Master, they can only unlock for themselves
    const isPrivileged = user.role === "ADMIN" || user.role === "MASTER";

    if (!isPrivileged) {
      // Force visitorId to be the current user's visitor profile
      // We need to find which visitor profile corresponds to this achievement's tenant
      // But first we need the achievement to know the tenantId
      const achievementCheck = await prisma.achievement.findUnique({
        where: { id: achievementId },
        select: { tenantId: true }
      });

      if (!achievementCheck) return res.status(404).json({ message: "Conquista não encontrada" });

      const myVisitor = await prisma.visitor.findFirst({
        where: {
          email: user.email,
          tenantId: achievementCheck.tenantId
        }
      });

      if (!myVisitor) {
        return res.status(403).json({ message: "Perfil de visitante não encontrado para este museu." });
      }

      visitorId = myVisitor.id;
    }

    if (!visitorId) {
      return res.status(400).json({ message: "visitorId é obrigatório (ou perfil não encontrado)" });
    }

    // 1. Buscamos a conquista para saber quanto XP ela vale
    const achievement = await prisma.achievement.findUnique({
      where: { id: achievementId }
    });

    if (!achievement) {
      return res.status(404).json({ message: "Conquista não encontrada" });
    }

    const existing = await prisma.visitorAchievement.findFirst({
      where: { visitorId, achievementId }
    });

    if (existing) {
      return res.status(400).json({ message: "Conquista já desbloqueada" });
    }

    // 2. Cria o registro e dispara a fila de XP (Event-Driven)
    const unlocked = await prisma.visitorAchievement.create({
      data: {
        visitorId,
        achievementId
      },
      include: {
        achievement: true
      }
    });

    await dispatchEvent(backgroundQueue, 'AwardGamificationXP', {
      visitorId,
      xp: Number(achievement.xpReward || 0),
      reason: `Desbloqueio de Conquista: ${achievement.title}`
    });

    return res.status(201).json({ ...unlocked, asyncXpQueued: true });
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
