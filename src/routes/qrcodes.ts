import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role, QRType } from "@prisma/client";
import crypto from "crypto";
import { z } from "zod";
import { checkEntityOwnership, assertTenantOwnership } from "../utils/ownership.js";

const router = Router();

// Lista QR Codes de um tenant
router.get("/", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
  try {
    const user = req.user!;
    let tenantId = req.query.tenantId as string | undefined;

    if (user.role === Role.ADMIN) {
      tenantId = user.tenantId || undefined;
    }

    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }

    const qrs = await prisma.qRCode.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" }
    });
    return res.json(qrs);
  } catch (err) {
    console.error("Erro listar QR Codes", err);
    return res.status(500).json({ message: "Erro ao listar QR Codes" });
  }
});

// Criar QR Code
router.post("/", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
  try {
    const user = req.user!;
    const qrSchema = z.object({
      type: z.nativeEnum(QRType),
      referenceId: z.string().optional(),
      title: z.string().optional(),
      xpReward: z.number().int().min(0).optional(),
      tenantId: z.string().optional(),
      code: z.string().optional()
    });

    const data = qrSchema.parse(req.body);
    let tenantId = data.tenantId;

    if (user.role === Role.ADMIN) {
      tenantId = user.tenantId || undefined;
    }

    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }

    // Se customCode foi enviado, verificar unicidade
    if (data.code) {
      const existing = await prisma.qRCode.findUnique({ where: { code: data.code } });
      if (existing) {
        return res.status(400).json({ message: "Este código já está em uso." });
      }
    }

    const code = data.code || crypto.randomBytes(6).toString("hex");
    const qr = await prisma.qRCode.create({
      data: {
        code,
        type: data.type,
        referenceId: data.referenceId || null,
        title: data.title || "QR Code",
        xpReward: data.xpReward ?? 5,
        tenantId
      }
    });

    return res.status(201).json(qr);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
    }
    console.error("Erro criar QR Code", err);
    return res.status(500).json({ message: "Erro ao criar QR Code" });
  }
});

// Delete
router.delete("/:id", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
  try {
    const { id } = req.params;
    await assertTenantOwnership({ model: 'qRCode', id, user: req.user! });

    await prisma.qRCode.delete({ where: { id } });
    return res.status(204).send();
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("Erro excluir QR Code", err);
    return res.status(500).json({ message: "Erro ao excluir QR Code" });
  }
});

// Resolve QR Code
router.get("/:code/resolve", async (req, res) => {
  try {
    const { code } = req.params;
    const qr = await prisma.qRCode.findUnique({
      where: { code },
      include: { tenant: true }
    });

    if (!qr) {
      return res.status(404).json({ error: "QR_NOT_FOUND", message: "QR Code não encontrado." });
    }

    let redirectUrl = "/hub";
    let citySlug = qr.tenant.slug;
    let equipmentSlug = qr.tenant.slug; 

    // Locate Equipment Slug if available
    const equipamento = await prisma.equipamentoCultural.findFirst({
       where: { tenantId: qr.tenantId }
    });
    
    if (qr.tenant.type === 'CITY' || qr.tenant.type === 'SECRETARIA') {
        citySlug = qr.tenant.slug;
    } else if (qr.tenant.parentId) {
        const parent = await prisma.tenant.findUnique({ where: { id: qr.tenant.parentId } });
        if (parent) citySlug = parent.slug;
    }

    if (equipamento) {
        equipmentSlug = equipamento.slug;
        citySlug = equipamento.cidade.toLowerCase().replace(/ /g, '-');
    }

    switch (qr.type) {
      case 'CITY':
        redirectUrl = `/cidades/${citySlug}`;
        break;
      case 'EQUIPMENT':
        redirectUrl = `/cidades/${citySlug}/equipamentos/${equipmentSlug}`;
        break;
      case 'WORK':
        redirectUrl = `/cidades/${citySlug}/equipamentos/${equipmentSlug}/obras/${qr.referenceId}`;
        break;
      case 'EVENT':
        redirectUrl = `/cidades/${citySlug}/equipamentos/${equipmentSlug}/eventos/${qr.referenceId}`;
        break;
      case 'EXHIBITION':
        redirectUrl = `/cidades/${citySlug}/equipamentos/${equipmentSlug}/exposicoes/${qr.referenceId}`;
        break;
      case 'TRAIL':
        redirectUrl = `/cidades/${citySlug}/equipamentos/${equipmentSlug}/roteiros/${qr.referenceId}`;
        break;
      case 'ROOM':
        redirectUrl = `/cidades/${citySlug}/equipamentos/${equipmentSlug}/espacos/${qr.referenceId}`;
        break;
      case 'TICKET':
        redirectUrl = `/ingresso/${qr.referenceId}`;
        break;
      default:
        redirectUrl = `/cidades/${citySlug}/equipamentos/${equipmentSlug}`;
    }

    return res.json({
      code: qr.code,
      type: qr.type,
      status: "ACTIVE",
      redirectUrl,
      title: qr.title,
      trackScan: true,
      xpReward: qr.xpReward,
      requiresAuth: false,
      expiresAt: null
    });
  } catch (err) {
    console.error("Erro ao resolver QR", err);
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao resolver QR Code" });
  }
});

// Registrar Scan — Gamificação completa
router.post("/:code/scan", authMiddleware, async (req, res) => {
  try {
    const { code } = req.params;
    const user = req.user!;

    const qr = await prisma.qRCode.findUnique({
      where: { code },
      include: { tenant: true }
    });

    if (!qr) {
      return res.status(404).json({ error: "QR_NOT_FOUND", message: "QR Code não encontrado." });
    }

    // Localizar perfil de visitante do usuário logado neste tenant
    const visitor = await prisma.visitor.findFirst({
      where: {
        email: user.email.toLowerCase(),
        tenantId: qr.tenantId
      }
    });

    // Se usuário autenticado mas sem perfil de visitante neste tenant, retornar sem XP
    if (!visitor) {
      return res.json({
        success: true,
        xpGained: 0,
        newTotalXp: 0,
        level: 1,
        nextLevelXp: 100,
        progressPercent: 0,
        stampCreated: false,
        achievementsUnlocked: [],
        message: "Perfil de visitante não encontrado para este espaço."
      });
    }

    // Anti-cheat: verificar se já capturou esse item (para WORK, único por obra)
    let alreadyStamped = false;
    if (qr.type === "WORK" && qr.referenceId) {
      const existingStamp = await prisma.passportStamp.findUnique({
        where: {
          visitorId_workId: { visitorId: visitor.id, workId: qr.referenceId }
        }
      });
      if (existingStamp) alreadyStamped = true;
    }

    const xpToAdd = alreadyStamped ? 0 : (qr.xpReward || 5);
    let stampCreated = false;

    // Transação atômica: XP + PassportStamp
    const updatedVisitor = await prisma.$transaction(async (tx) => {
      // 1. Creditar XP no Visitor
      const updated = await tx.visitor.update({
        where: { id: visitor.id },
        data: { xp: { increment: xpToAdd } }
      });

      // 2. Criar PassportStamp se for WORK e ainda não carimbado
      if (qr.type === "WORK" && qr.referenceId && !alreadyStamped) {
        try {
          const stampCount = await tx.passportStamp.count({ where: { visitorId: visitor.id } });
          await tx.passportStamp.create({
            data: {
              visitorId: visitor.id,
              workId: qr.referenceId,
              raridade: "COMMON",
              numeroCaptura: stampCount + 1,
              xpGanho: xpToAdd
            }
          });
          stampCreated = true;
        } catch {
          // Constraint única — carimbo já existe por race condition
        }
      }

      return updated;
    });

    // 3. Verificar conquistas autoTrigger (fora da transação para não bloquear)
    const achievementsUnlocked: Array<{ id: string; title: string; iconUrl?: string | null }> = [];

    const autoAchievements = await prisma.achievement.findMany({
      where: { tenantId: qr.tenantId, autoTrigger: true, active: true }
    });

    for (const achievement of autoAchievements) {
      // Verificar se já desbloqueou
      const alreadyUnlocked = await prisma.visitorAchievement.findFirst({
        where: { visitorId: visitor.id, achievementId: achievement.id }
      });
      if (alreadyUnlocked) continue;

      // Avaliar condição
      let conditionMet = false;
      try {
        const cond = achievement.condition as { type?: string; value?: number } | null;
        if (!cond) {
          conditionMet = true;
        } else if (cond.type === "FIRST_SCAN") {
          conditionMet = true;
        } else if (cond.type === "XP_THRESHOLD" && cond.value) {
          conditionMet = updatedVisitor.xp >= cond.value;
        } else if (cond.type === "STAMPS_COUNT" && cond.value) {
          const stampCount = await prisma.passportStamp.count({ where: { visitorId: visitor.id } });
          conditionMet = stampCount >= cond.value;
        }
      } catch {
        // Condição malformada — ignorar
      }

      if (conditionMet) {
        try {
          await prisma.visitorAchievement.create({
            data: { visitorId: visitor.id, achievementId: achievement.id }
          });
          achievementsUnlocked.push({
            id: achievement.id,
            title: achievement.title,
            iconUrl: achievement.iconUrl
          });
        } catch {
          // Race condition — outra requisição já desbloqueou
        }
      }
    }

    // 4. Calcular nível atual (thresholds consistentes com o frontend)
    const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2200, 3000, 4000, 5500, 7500];
    const newXp = updatedVisitor.xp;
    let level = 1;
    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (newXp >= LEVEL_THRESHOLDS[i]) { level = i + 1; break; }
    }
    const currentLevelXp = LEVEL_THRESHOLDS[level - 1] ?? 0;
    const nextLevelXp = LEVEL_THRESHOLDS[level] ?? LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
    const progressPercent = nextLevelXp > currentLevelXp
      ? Math.min(100, Math.round(((newXp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100))
      : 100;

    return res.json({
      success: true,
      xpGained: xpToAdd,
      newTotalXp: newXp,
      level,
      nextLevelXp,
      progressPercent,
      stampCreated,
      achievementsUnlocked
    });

  } catch (err) {
    console.error("Erro ao registrar scan do QR", err);
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao registrar leitura" });
  }
});

export default router;

