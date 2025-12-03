import { Router } from "express";
import { prisma } from "../prisma.js";

const router = Router();

// Cria visitante anônimo simples vinculado a um tenant
router.post("/register", async (req, res) => {
  try {
    interface RegisterVisitorBody {
      tenantId: string;
      name?: string;
      email?: string;
    }

    const { tenantId, name, email } = req.body as RegisterVisitorBody;
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }
    const visitor = await prisma.visitor.create({
      data: {
        tenantId,
        name: name || null,
        email: email || null
      }
    });
    return res.status(201).json(visitor);
  } catch (err) {
    console.error("Erro criar visitante", err);
    return res.status(500).json({ message: "Erro ao criar visitante" });
  }
});

// Rastreia uma visita genérica (não via QR)
router.post("/track", async (req, res) => {
  try {
    const { visitorId, workId, trailId, eventId, xpGained } = req.body as {
      visitorId?: string;
      workId?: string;
      trailId?: string;
      eventId?: string;
      xpGained?: number;
    };

    if (!visitorId) {
      return res.status(400).json({ message: "visitorId é obrigatório" });
    }

    const visitor = await prisma.visitor.findUnique({ where: { id: visitorId } });
    if (!visitor) {
      return res.status(404).json({ message: "Visitante não encontrado" });
    }

    const xpToAdd = xpGained ?? 1;

    await prisma.$transaction([
      prisma.visitorVisit.create({
        data: {
          visitorId,
          workId: workId || null,
          trailId: trailId || null,
          eventId: eventId || null,
          source: "APP",
          xpGained: xpToAdd
        }
      }),
      prisma.visitor.update({
        where: { id: visitorId },
        data: { xp: { increment: xpToAdd } }
      })
    ]);

    return res.status(201).json({ message: "Visita registrada", xpGained: xpToAdd });
  } catch (err) {
    console.error("Erro registrar visita", err);
    return res.status(500).json({ message: "Erro ao registrar visita" });
  }
});

// Registra visita vinda do fluxo de QR do front (/visitors/visit-from-qr)
router.post("/visit-from-qr", async (req, res) => {
  try {
    const { code } = req.body as { code?: string };
    if (!code) {
      return res.status(400).json({ message: "code é obrigatório" });
    }

    const qr = await prisma.qRCode.findUnique({ where: { code } });
    if (!qr) {
      return res.status(404).json({ message: "QR Code não encontrado" });
    }

    // Busca (ou cria) um visitante anônimo padrão por tenant
    let visitor = await prisma.visitor.findFirst({
      where: { tenantId: qr.tenantId, email: null }
    });

    if (!visitor) {
      visitor = await prisma.visitor.create({
        data: {
          tenantId: qr.tenantId,
          name: "Visitante Anônimo",
          email: null
        }
      });
    }

    const xpToAdd = qr.xpReward || 5;

    let workId: string | null = null;
    let trailId: string | null = null;
    let eventId: string | null = null;

    if (qr.type === "WORK") workId = qr.referenceId;
    if (qr.type === "TRAIL") trailId = qr.referenceId;
    if (qr.type === "EVENT") eventId = qr.referenceId;

    const operations: any[] = [
      prisma.visitorVisit.create({
        data: {
          visitorId: visitor.id,
          workId,
          trailId,
          eventId,
          source: "QR",
          xpGained: xpToAdd
        }
      }),
      prisma.visitor.update({
        where: { id: visitor.id },
        data: { xp: { increment: xpToAdd } }
      })
    ];

    if (workId) {
      const existingStamp = await prisma.passportStamp.findFirst({
        where: { visitorId: visitor.id, workId }
      });

      if (!existingStamp) {
        operations.push(
          prisma.passportStamp.create({
            data: {
              visitorId: visitor.id,
              workId
            }
          })
        );
      }
    }

    await prisma.$transaction(operations);

    return res.status(201).json({
      message: "Visita via QR registrada",
      xpGained: xpToAdd,
      type: qr.type,
      referenceId: qr.referenceId
    });
  } catch (err) {
    console.error("Erro visit-from-qr", err);
    return res.status(500).json({ message: "Erro ao registrar visita via QR" });
  }
});

// Summary do visitante pelo id (ainda pode ser usado em integrações futuras)
router.get("/:visitorId/summary", async (req, res) => {
  try {
    const { visitorId } = req.params;

    const visitor = await prisma.visitor.findUnique({
      where: { id: visitorId },
      include: {
        visits: { orderBy: { createdAt: "desc" }, take: 100, include: { work: true } },
        achievements: { include: { achievement: true } }
      }
    });

    if (!visitor) {
      return res.status(404).json({ message: "Visitante não encontrado" });
    }

    const stamps = visitor.visits
      .filter((v) => v.work)
      .map((v) => ({
        workTitle: v.work!.title,
        date: v.createdAt.toISOString()
      }));

    const xp = visitor.xp;

    return res.json({
      xp,
      stamps,
      achievements: visitor.achievements.map((va) => ({
        id: va.achievement.id,
        code: va.achievement.code,
        title: va.achievement.title,
        description: va.achievement.description,
        unlockedAt: va.unlockedAt
      })),
      visitsCount: visitor.visits.length
    });
  } catch (err) {
    console.error("Erro summary visitante", err);
    return res.status(500).json({ message: "Erro ao buscar resumo" });
  }
});

// Summary genérico para o front (/visitors/me/summary)
// Agora filtra pelo email do usuário logado
router.get("/me/summary", async (req, res) => {
  try {
    const { email, tenantId } = req.query as { email?: string; tenantId?: string };

    if (!email || !tenantId) {
      // Se não tiver email/tenantId, retorna vazio para não vazar dados globais
      return res.json({ xp: 0, stamps: [], visitsCount: 0, achievements: [] });
    }

    const visitor = await prisma.visitor.findFirst({
      where: { email, tenantId },
      include: {
        visits: { orderBy: { createdAt: "desc" }, take: 100, include: { work: true } },
        achievements: { include: { achievement: true } }
      }
    });

    if (!visitor) {
      return res.json({ xp: 0, stamps: [], visitsCount: 0, achievements: [] });
    }

    const stamps = visitor.visits
      .filter((v) => v.work)
      .map((v) => ({
        workTitle: v.work!.title,
        date: v.createdAt.toISOString()
      }));

    const xp = visitor.xp;

    return res.json({
      xp,
      stamps,
      achievements: visitor.achievements.map((va) => ({
        id: va.achievement.id,
        code: va.achievement.code,
        title: va.achievement.title,
        description: va.achievement.description,
        unlockedAt: va.unlockedAt
      })),
      visitsCount: visitor.visits.length
    });
  } catch (err) {
    console.error("Erro me/summary", err);
    return res.status(500).json({ message: "Erro ao buscar resumo" });
  }
});

// Atualiza dados do visitante logado (ou identificado por email/tenant)
router.put("/me", async (req, res) => {
  try {
    const { email, tenantId, name, newEmail } = req.body;

    if (!email || !tenantId) {
      return res.status(400).json({ message: "Email atual e Tenant ID são obrigatórios" });
    }

    const visitor = await prisma.visitor.findFirst({
      where: { email, tenantId }
    });

    if (!visitor) {
      return res.status(404).json({ message: "Visitante não encontrado" });
    }

    const updated = await prisma.visitor.update({
      where: { id: visitor.id },
      data: {
        name: name || visitor.name,
        email: newEmail || visitor.email
      }
    });

    return res.json(updated);
  } catch (err) {
    console.error("Erro ao atualizar visitante", err);
    return res.status(500).json({ message: "Erro ao atualizar perfil" });
  }
});

export default router;
