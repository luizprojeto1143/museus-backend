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
    const tenantId = (req as any).tenantId || req.query.tenantId;
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
          visits: {
            select: {
              workId: true,
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
      // Obras visitadas = visitas que possuem workId
      const worksVisited = v.visits.filter(visit => visit.workId).length;

      // Trilhas únicas
      const uniqueTrails = new Set(v.visits.filter(visit => visit.trailId).map(visit => visit.trailId));

      // Eventos únicos
      const uniqueEvents = new Set(v.visits.filter(visit => visit.eventId).map(visit => visit.eventId));

      return {
        id: v.id,
        name: v.name,
        email: v.email,
        xp: v.xp,
        trailsCompleted: uniqueTrails.size,
        worksVisited: worksVisited,
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
    console.error("Erro ao listar visitantes:", err);
    return res.status(500).json({ 
      message: "Erro ao listar visitantes",
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

// Perfil do visitante logado
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const email = req.user?.email;
    const tenantId = (req as any).tenantId;

    if (!email || !tenantId) {
      return res.status(400).json({ message: "email e tenantId são obrigatórios" });
    }

    let visitor = await prisma.visitor.findFirst({
      where: { email: email.toLowerCase(), tenantId },
      include: {
        visits: {
          include: {
            work: { select: { title: true } },
            trail: { select: { title: true } },
            event: { select: { title: true } }
          },
          orderBy: { createdAt: "desc" },
          take: 50
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
      // Criação automática do perfil de visitante ao primeiro acesso logado neste museu
      visitor = await prisma.visitor.create({
        data: {
          email: email.toLowerCase(),
          tenantId,
          name: req.user?.name || "Visitante",
          xp: 0
        },
        include: {
          visits: true,
          achievements: true
        }
      }) as any;
    }

    return res.json(visitor);
  } catch (err) {
    console.error("Erro ao buscar perfil do visitante:", err);
    return res.status(500).json({ message: "Erro interno ao buscar perfil" });
  }
});

// Resumo do visitante atual (por email/tenantId)
router.get("/me/summary", async (req, res) => {
  try {
    const { email } = req.query as { email?: string };
    const tenantId = (req as any).tenantId || req.query.tenantId;

    if (!email || !tenantId) {
      return res.status(400).json({ message: "email e tenantId são obrigatórios" });
    }

    const visitor = await prisma.visitor.findFirst({
      where: { email: email.toLowerCase(), tenantId },
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

    const stamps = visitor.stamps.map(s => ({
      workId: s.work?.id,
      workTitle: s.work?.title || "Obra",
      workImageUrl: s.work?.imageUrl,
      date: s.stampedAt
    }));

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

    const currentXp = visitor.xp;
    let level = 1;
    let nextLevelXpThreshold = 100;
    let tempXp = currentXp;

    let iterations = 0;
    while (tempXp >= nextLevelXpThreshold && iterations < 1000) {
      tempXp -= nextLevelXpThreshold;
      level += 1;
      nextLevelXpThreshold = Math.floor(nextLevelXpThreshold * 1.3) || 100;
      iterations++;
    }

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
      level: level,
      nextLevelXp: nextLevelXpThreshold
    });
  } catch (err) {
    console.error("Erro me summary:", err);
    return res.status(500).json({ 
      message: "Erro ao buscar resumo",
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

// --- PUBLIC ROUTES (Define before param routes) ---

// Cria visitante anônimo simples vinculado a um tenant
router.post("/register", async (req, res) => {
  try {
    const registerSchema = z.object({
      tenantId: z.string().min(1, "Tenant ID é obrigatório"),
      name: z.string().optional(),
      email: z.string().email("Email inválido").optional(),
      age: z.any().optional().transform(v => {
        if (v === null || v === "" || v === undefined) return undefined;
        const n = Math.floor(Number(v));
        return (isNaN(n) || n <= 0) ? undefined : n;
      }),
      photoUrl: z.string().optional()
    });

    const data = registerSchema.parse(req.body);
    const { tenantId, name, email, age, photoUrl } = data;

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
          age: age || undefined,
          photoUrl: photoUrl || undefined
        },
        create: {
          tenantId,
          name: name || null,
          email: normalizedEmail,
          age: age || null,
          photoUrl: photoUrl || null
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
          age: age || null,
          photoUrl: photoUrl || null
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
          tenantId: visitor.tenantId,
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

// Registrar visita via QR
router.post("/visit-from-qr", async (req, res) => {
  // ... Implementation already exists, just keeping structure ...
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || req.query.tenantId;

    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório para isolamento de dados" });
    }

    const visitor = await prisma.visitor.findFirst({
      where: { id, tenantId: String(tenantId) },
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
      return res.status(404).json({ message: "Visitante não encontrado ou pertence a outro museu" });
    }

    return res.json(visitor);
  } catch (err) {
    console.error("Erro ao buscar detalhes do visitante", err);
    return res.status(500).json({ message: "Erro ao buscar detalhes do visitante" });
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

    let isVestige = false;
    if (qr.type === "WORK" && qr.referenceId) {
       const w = await prisma.work.findUnique({ where: { id: qr.referenceId }, select: { vestigeActive: true } });
       if (w?.vestigeActive) isVestige = true;
    }

    if (qr.type === "WORK") workId = qr.referenceId;
    if (qr.type === "TRAIL") trailId = qr.referenceId;
    if (qr.type === "EVENT") eventId = qr.referenceId;

    // Handle Cultural Equipment Check-in
    if (qr.type === "EQUIPAMENTO" && qr.referenceId) {
       // L5 Fix: Check if already checked in today via QR/GPS
       const today = new Date();
       today.setHours(0,0,0,0);
       
       const existingCheckin = await prisma.equipamentoCheckin.findFirst({
         where: {
           visitorId: visitor.id,
           equipamentoId: qr.referenceId,
           createdAt: { gte: today }
         }
       });

       if (existingCheckin) {
         return res.json({
           message: "Você já realizou o check-in hoje!",
           xpGained: 0,
           type: qr.type,
           referenceId: qr.referenceId,
           visitorName: visitor.name
         });
       }

       const xpGained = qr.xpReward || 20;

       await prisma.$transaction([
         prisma.equipamentoCheckin.create({
           data: {
             equipamentoId: qr.referenceId,
             visitorId: visitor.id,
             method: "qr_entrada",
             xpGanho: xpGained
           }
         }),
         prisma.visitor.update({
           where: { id: visitor.id },
           data: { xp: { increment: xpGained } }
         })
       ]);
       
       return res.status(201).json({
         message: "Check-in realizado com sucesso no equipamento!",
         xpGained,
         type: qr.type,
         referenceId: qr.referenceId,
         visitorName: visitor.name
       });
    }

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
          tenantId: qr.tenantId,
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
        // Check if ALL items in the trail are visited
        const trail = await prisma.trail.findUnique({ where: { id: trailId } });
        if (trail && trail.workIds.length > 0) {
          const visitedInTrail = await prisma.visitorVisit.findMany({
            where: {
              visitorId: visitor.id,
              trailId: trailId,
              workId: { in: trail.workIds }
            },
            select: { workId: true }
          });

          const uniqueVisited = new Set(visitedInTrail.map(v => v.workId));
          if (uniqueVisited.size >= trail.workIds.length) {
            await CertificateEngine.evaluate('TRAIL_COMPLETED', {
              tenantId: qr.tenantId,
              visitorId: visitor.id,
              trailId: trailId
            });
          }
        }
      }

      if (eventId) {
        await CertificateEngine.evaluate('EVENT_ATTENDED', {
          tenantId: qr.tenantId,
          visitorId: visitor.id,
          eventId: eventId
        });
      }

      // === NEW: Auto-mint Collectible Card if exists for this work ===
      if (workId) {
        const cardMatching = await prisma.collectibleCard.findFirst({
          where: { workId, tenantId: qr.tenantId }
        });

        if (cardMatching) {
          // Check if already owned
          const alreadyOwned = await prisma.visitorCard.findUnique({
            where: { cardId_visitorId: { cardId: cardMatching.id, visitorId: visitor.id } }
          });

          if (!alreadyOwned) {
            // Check availability (minting limit)
            const ownedCount = await prisma.visitorCard.count({ where: { cardId: cardMatching.id } });
            if (ownedCount < cardMatching.totalMinted) {
              await prisma.visitorCard.create({
                data: {
                  cardId: cardMatching.id,
                  visitorId: visitor.id
                }
              });
              console.log(`[Auto-Mint] Card "${cardMatching.title}" awarded to ${visitor.name}`);
            }
          }
        }
      }

    } catch (e) { console.error("Hook Error", e); }



    return res.status(201).json({
      message: xpMessage || "Visita via QR registrada",
      xpGained: calculatedXp,
      type: qr.type,
      referenceId: qr.referenceId,
      isVestige,
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

// Listar skins adquiridas pelo visitante
router.get("/:id/skins", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const skins = await prisma.visitorSkin.findMany({
      where: { visitorId: id },
      include: { skin: true },
      orderBy: { acquiredAt: "desc" }
    });
    return res.json(skins);
  } catch (err) {
    console.error("Erro ao listar skins do visitante:", err);
    return res.status(500).json({ message: "Erro ao listar skins" });
  }
});

// GET /visitors/public-passport/:id - Ver passaporte público de um visitante (C4)
router.get("/public-passport/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const visitor = await prisma.visitor.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        photoUrl: true,
        xp: true,
        createdAt: true
      }
    });

    if (!visitor) {
      return res.status(404).json({ message: "Visitante não encontrado" });
    }

    const stamps = await (prisma.passportStamp as any).findMany({
      where: { visitorId: id },
      include: {
        work: {
          select: {
            title: true,
            artist: true,
            vestigeImageUrl: true,
            imageUrl: true,
            tenant: {
              select: { name: true, city: true }
            }
          }
        }
      },
      orderBy: { stampedAt: "desc" }
    });

    return res.json({
      visitor,
      stamps
    });
  } catch (err) {
    console.error("Erro ao buscar passaporte público:", err);
    return res.status(500).json({ message: "Erro ao buscar passaporte público" });
  }
});

export default router;
