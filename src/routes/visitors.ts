import { Router } from "express";
import { prisma } from "../prisma.js";
import jwt from "jsonwebtoken";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { z } from "zod";
import { Role } from "@prisma/client";
import { CertificateEngine } from "../services/certificate-engine.js";

const router = Router();

// Lista visitantes de um tenant (com paginação) - Protegido (Admin/Master only)
router.get("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { tenantId } = req.query as { tenantId?: string };
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }

    const [visitors, total] = await Promise.all([
      prisma.visitor.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          _count: {
            select: {
              visits: true
            }
          },
          visits: {
            select: {
              trailId: true,
              eventId: true
            }
          }
        }
      }),
      prisma.visitor.count({ where: { tenantId } })
    ]);

    // Mapear para o formato esperado pelo front
    const formatted = visitors.map(v => {
      // Count unique trails and events visited
      const uniqueTrails = new Set(v.visits.filter(visit => visit.trailId).map(visit => visit.trailId));
      const uniqueEvents = new Set(v.visits.filter(visit => visit.eventId).map(visit => visit.eventId));

      return {
        id: v.id,
        name: v.name,
        email: v.email,
        xp: v.xp,
        trailsCompleted: uniqueTrails.size,
        worksVisited: v._count.visits,
        eventsAccessed: uniqueEvents.size,
        firstAccessAt: v.createdAt,
        lastAccessAt: v.updatedAt
      };
    });

    return res.json({
      data: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Erro ao listar visitantes", err);
    return res.status(500).json({ message: "Erro ao listar visitantes" });
  }
});

// Resumo do visitante atual (por email/tenantId)
router.get("/me/summary", async (req, res) => {
  try {
    const { email, tenantId } = req.query as { email?: string; tenantId?: string };

    if (!email || !tenantId) {
      return res.status(400).json({ message: "email e tenantId são obrigatórios" });
    }

    const visitor = await prisma.visitor.findFirst({
      where: { email, tenantId },
      include: {
        visits: {
          orderBy: { createdAt: "desc" },
          take: 50,
          include: {
            work: {
              select: {
                id: true,
                title: true,
                imageUrl: true
              }
            }
          }
        },
        achievements: { include: { achievement: true } },
        stamps: { include: { work: { select: { id: true, title: true, imageUrl: true } } } }
      }
    });

    if (!visitor) {
      // Retorna 200 com dados zerados em vez de 404 para nao quebrar o front se for novo
      return res.json({
        xp: 0,
        stamps: [],
        visits: [],
        achievements: [],
        visitsCount: 0,
        level: 1,
        nextLevelXp: 100
      });
    }

    // Format stamps with work info
    const stamps = visitor.stamps.map(s => ({
      workId: s.work?.id,
      workTitle: s.work?.title || "Obra",
      workImageUrl: s.work?.imageUrl,
      date: s.stampedAt
    }));

    // Format visits with work info
    const visits = visitor.visits
      .filter(v => v.work)
      .map(v => ({
        id: v.id,
        work: v.work ? {
          id: v.work.id,
          title: v.work.title,
          imageUrl: v.work.imageUrl
        } : null,
        createdAt: v.createdAt,
        xpGained: v.xpGained
      }));

    return res.json({
      id: visitor.id,
      name: visitor.name,
      xp: visitor.xp,
      stamps,
      visits,
      achievements: visitor.achievements.map((va) => ({
        id: va.achievement.id,
        code: va.achievement.code,
        title: va.achievement.title,
        description: va.achievement.description,
        iconUrl: va.achievement.iconUrl,
        unlockedAt: va.unlockedAt
      })),
      visitsCount: visitor.visits.length,
      level: Math.floor(visitor.xp / 100) + 1,
      nextLevelXp: (Math.floor(visitor.xp / 100) + 1) * 100
    });
  } catch (err) {
    console.error("Erro me summary", err);
    return res.status(500).json({ message: "Erro ao buscar resumo" });
  }
});
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Evitar conflito com outras rotas que começam com string fixa se não for UUID
    // Mas como as outras rotas são /register, /track, /visit-from-qr, /me/summary, elas são fixas e devem vir ANTES de /:id se definidas no mesmo nível.
    // Como /register, /track etc estão definidas DEPOIS de /, mas ANTES de /:id se eu colocar aqui, o Express resolve na ordem de definição.
    // Vou mover essa rota para o final do arquivo ou garantir que ela não capture palavras chave.
    // Melhor estratégia: colocar rotas fixas antes de rotas parametrizadas.

    const visitor = await prisma.visitor.findUnique({
      where: { id },
      include: {
        visits: {
          include: {
            work: { select: { title: true } },
            trail: { select: { title: true } },
            event: { select: { title: true } }
          },
          orderBy: { createdAt: "desc" }
        },
        achievements: {
          include: {
            achievement: {
              select: {
                title: true,
                iconUrl: true,
                xpReward: true
              }
            }
          }
        }
      }
    });

    if (!visitor) {
      return res.status(404).json({ message: "Visitante não encontrado" });
    }

    return res.json(visitor);
  } catch (err) {
    console.error("Erro ao buscar detalhes do visitante", err);
    return res.status(500).json({ message: "Erro ao buscar detalhes do visitante" });
  }
});

// Cria visitante anônimo simples vinculado a um tenant
// Cria visitante anônimo simples vinculado a um tenant
router.post("/register", async (req, res) => {
  try {
    const registerSchema = z.object({
      tenantId: z.string().min(1, "Tenant ID é obrigatório"),
      name: z.string().optional(),
      email: z.string().email("Email inválido").optional(),
      age: z.number().int().positive().optional()
    });

    const data = registerSchema.parse(req.body);
    const { tenantId, name, email, age } = data;

    // Use upsert to handle case where Visitor exists (orphan) but User is new
    if (email) {
      const normalizedEmail = email.toLowerCase();
      const visitor = await prisma.visitor.upsert({
        where: {
          email_tenantId: {
            email: normalizedEmail,
            tenantId
          }
        },
        update: {
          name: name || undefined,
          age: age || undefined
        },
        create: {
          tenantId,
          name: name || null,
          email: normalizedEmail,
          age: age || null
        }
      });
      return res.status(201).json(visitor);
    } else {
      // Fallback for no email
      const visitor = await prisma.visitor.create({
        data: {
          tenantId,
          name: name || null,
          email: null,
          age: age || null
        }
      });
      return res.status(201).json(visitor);
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
    }
    console.error("Erro criar visitante", err);
    return res.status(500).json({ message: "Erro ao criar visitante" });
  }
});

// Rastreia uma visita genérica (não via QR)
router.post("/track", async (req, res) => {
  try {
    const trackSchema = z.object({
      visitorId: z.string().uuid("visitorId inválido"),
      workId: z.string().optional(),
      trailId: z.string().optional(),
      eventId: z.string().optional(),
      xpGained: z.number().int().nonnegative().max(100, "XP máximo por ação excede limite").optional()
    });

    const parsed = trackSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.errors });
    }

    const { visitorId, workId, trailId, eventId, xpGained } = parsed.data;

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
    const { code, email: bodyEmail } = req.body as { code?: string; email?: string };
    if (!code) {
      return res.status(400).json({ message: "code é obrigatório" });
    }

    const qr = await prisma.qRCode.findUnique({ where: { code } });
    if (!qr) {
      return res.status(404).json({ message: "QR Code não encontrado" });
    }

    // Tentar identificar o visitante
    let visitorEmail: string | null = null;

    // 1. Tentar pelo token JWT
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.split(" ")[1];
      try {
        // SECURITY FIX: Remove fallback "dev-secret". rely on env.
        const JWT_SECRET = process.env.JWT_SECRET!;
        const decoded = jwt.verify(token, JWT_SECRET) as { email: string };
        if (decoded && decoded.email) {
          visitorEmail = decoded.email;
        }
      } catch (e) {
        // Token inválido ou expirado, ignorar e tentar outras formas
        console.warn("Token inválido em visit-from-qr", e);
      }
    }

    // 2. Se não achou no token, tentar pelo body (fallback)
    if (!visitorEmail && bodyEmail) {
      visitorEmail = bodyEmail;
    }

    // Busca (ou cria) o visitante
    let visitor;

    if (visitorEmail) {
      // Busca visitante logado vinculado a este tenant
      visitor = await prisma.visitor.findFirst({
        where: { tenantId: qr.tenantId, email: visitorEmail }
      });

      // Se o usuário existe no sistema (User) mas ainda não tem registro de Visitor neste tenant, cria agora
      if (!visitor) {
        // Verifica se existe User com esse email para pegar o nome
        const user = await prisma.user.findUnique({ where: { email: visitorEmail } });

        visitor = await prisma.visitor.create({
          data: {
            tenantId: qr.tenantId,
            name: user?.name || "Visitante",
            email: visitorEmail
          }
        });
      }
    } else {
      // Fluxo anônimo (mantém lógica anterior)
      visitor = await prisma.visitor.findFirst({
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
    }

    const xpToAdd = qr.xpReward || 5;

    let workId: string | null = null;
    let trailId: string | null = null;
    let eventId: string | null = null;

    if (qr.type === "WORK") workId = qr.referenceId;
    if (qr.type === "TRAIL") trailId = qr.referenceId;
    if (qr.type === "EVENT") eventId = qr.referenceId;

    // ANTI-CHEAT / XP FARMING PREVENTION 🛡️
    // Check if user visited this item in the last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentVisit = await prisma.visitorVisit.findFirst({
      where: {
        visitorId: visitor.id,
        workId,
        eventId,
        createdAt: { gte: tenMinutesAgo }
      }
    });

    // If recently visited, track it but give 0 XP
    const calculatedXp = recentVisit ? 0 : (qr.xpReward || 5);
    const xpMessage = recentVisit ? "Visita registrada (sem XP extra por frequência)" : undefined;

    const operations: any[] = [
      prisma.visitorVisit.create({
        data: {
          visitorId: visitor.id,
          workId,
          trailId,
          eventId,
          source: "QR",
          xpGained: calculatedXp
        }
      })
    ];

    if (calculatedXp > 0) {
      operations.push(
        prisma.visitor.update({
          where: { id: visitor.id },
          data: { xp: { increment: calculatedXp } }
        })
      );
    }

    // ... (existing logic)

    await prisma.$transaction(operations);

    // Hook: Check XP Threshold & Event/Trails
    try {
      const updatedVisitor = await prisma.visitor.findUnique({ where: { id: visitor.id } });

      if (updatedVisitor) {
        await CertificateEngine.evaluate('XP_THRESHOLD', {
          tenantId: qr.tenantId,
          visitorId: visitor.id,
          newXp: updatedVisitor.xp
        });
      }

      if (trailId) {
        // For trails, we might need to check if ALL items are visited. 
        // complex logic omitted for now, assuming simple trigger
        await CertificateEngine.evaluate('TRAIL_COMPLETED', {
          tenantId: qr.tenantId,
          visitorId: visitor.id,
          trailId: trailId
        });
      }

      if (eventId) {
        await CertificateEngine.evaluate('EVENT_ATTENDED', {
          tenantId: qr.tenantId,
          visitorId: visitor.id,
          eventId: eventId
        });
      }

    } catch (e) { console.error("Hook Error", e); }



    return res.status(201).json({
      message: xpMessage || "Visita via QR registrada",
      xpGained: calculatedXp,
      type: qr.type,
      referenceId: qr.referenceId,
      visitorName: visitor.name
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



// Atualiza dados do visitante logado (ou identificado por email/tenant)
router.put("/me", authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    const { tenantId, name, newEmail } = req.body;
    const email = user.email; // Use authenticated user's email

    if (!tenantId) {
      return res.status(400).json({ message: "Tenant ID é obrigatório" });
    }

    const visitor = await prisma.visitor.findFirst({
      where: { email: email.toLowerCase(), tenantId }
    });

    if (!visitor) {
      return res.status(404).json({ message: "Visitante não encontrado" });
    }

    const updated = await prisma.visitor.update({
      where: { id: visitor.id },
      data: {
        name: name || visitor.name,
        email: newEmail ? newEmail.toLowerCase() : visitor.email
      }
    });

    return res.json(updated);
  } catch (err) {
    console.error("Erro ao atualizar visitante", err);
    return res.status(500).json({ message: "Erro ao atualizar perfil" });
  }
});

export default router;
