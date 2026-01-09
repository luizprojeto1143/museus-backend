import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// Resumo geral para MASTER
router.get("/tenants-summary", authMiddleware, requireRole([Role.MASTER]), async (_req, res) => {
  try {
    const tenants = await prisma.tenant.findMany({
      include: {
        works: true,
        trails: true,
        events: true,
        visitors: true
      }
    });

    const data = await Promise.all(
      tenants.map(async (t) => {
        const visitsCount = await prisma.visitorVisit.count({
          where: { visitor: { tenantId: t.id } }
        });

        return {
          tenantId: t.id,
          name: t.name,
          works: t.works.length,
          trails: t.trails.length,
          events: t.events.length,
          visitors: t.visitors.length,
          visits: visitsCount
        };
      })
    );

    return res.json(data);
  } catch (err) {
    console.error("Erro analytics tenants", err);
    return res.status(500).json({ message: "Erro ao carregar analytics" });
  }
});

// Resumo por tenant (ADMIN ou MASTER)
router.get("/tenant-summary/:tenantId", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { tenantId } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        works: true,
        trails: true,
        events: true,
        visitors: true
      }
    });

    if (!tenant) {
      return res.status(404).json({ message: "Tenant não encontrado" });
    }

    const visitsCount = await prisma.visitorVisit.count({
      where: { visitor: { tenantId } }
    });

    return res.json({
      tenantId: tenant.id,
      name: tenant.name,
      works: tenant.works.length,
      trails: tenant.trails.length,
      events: tenant.events.length,
      visitors: tenant.visitors.length,
      visits: visitsCount
    });
  } catch (err) {
    console.error("Erro analytics tenant", err);
    return res.status(500).json({ message: "Erro ao carregar analytics" });
  }
});

// Obras populares
router.get("/popular-works/:tenantId", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { tenantId } = req.params;

    const popular = await prisma.visitorVisit.groupBy({
      by: ["workId"],
      where: {
        workId: { not: null },
        visitor: { tenantId }
      },
      _count: { workId: true },
      orderBy: { _count: { workId: "desc" } },
      take: 5
    });

    // Enriquecer com detalhes da obra
    const enriched = await Promise.all(popular.map(async (p) => {
      const work = await prisma.work.findUnique({ where: { id: p.workId! } });
      return {
        workId: p.workId,
        title: work?.title || "Desconhecido",
        visits: p._count.workId
      };
    }));

    return res.json(enriched);
  } catch (err) {
    console.error("Erro popular works", err);
    return res.status(500).json({ message: "Erro ao buscar obras populares" });
  }
});

// Dashboard completo para Admin
router.get("/dashboard/:tenantId", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { tenantId } = req.params;

    // 1. Visitantes este mês
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const visitorsThisMonth = await prisma.visitorVisit.count({
      where: {
        visitor: { tenantId },
        createdAt: { gte: startOfMonth }
      }
    });

    // 2. Top Obras
    const topWorksRaw = await prisma.visitorVisit.groupBy({
      by: ["workId"],
      where: {
        workId: { not: null },
        visitor: { tenantId }
      },
      _count: { workId: true },
      orderBy: { _count: { workId: "desc" } },
      take: 5
    });

    const topWorks = await Promise.all(topWorksRaw.map(async (p) => {
      const work = await prisma.work.findUnique({ where: { id: p.workId! } });
      return {
        id: p.workId!,
        title: work?.title || "Desconhecido",
        visits: p._count.workId
      };
    }));

    // 3. Top Trilhas (Simulado por enquanto, pois não temos tabela de 'TrailCompletion' explícita ainda, ou usamos achievements)
    // Vamos contar achievements do tipo 'trail_completed' se existissem, ou apenas listar trilhas
    const topTrails: any[] = [];

    // 4. Top Eventos (Simulado)
    const topEvents: any[] = [];

    // 5. Total QR Scans (Total de visits com workId)
    const totalQRScans = await prisma.visitorVisit.count({
      where: {
        visitor: { tenantId },
        workId: { not: null }
      }
    });

    // 6. Total XP (Sum of user stats xp)
    const totalXP = await prisma.visitor.aggregate({
      where: { tenantId },
      _sum: { xp: true }
    });

    // 7. Visits by Day (Last 7 days)
    const visitsByDay = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(date.getDate() + 1);

      const count = await prisma.visitorVisit.count({
        where: {
          visitor: { tenantId },
          createdAt: { gte: date, lt: nextDate }
        }
      });

      visitsByDay.push({
        date: date.toLocaleDateString('pt-BR', { weekday: 'short' }),
        count
      });
    }

    return res.json({
      visitorsThisMonth,
      topWorks,
      topTrails,
      topEvents,
      totalQRScans,
      totalXPDistributed: totalXP._sum.xp || 0,
      weeklyGrowth: 0, // Placeholder
      monthlyGrowth: 0, // Placeholder
      visitsByDay,
      visitsByWork: topWorks.map(w => ({ workTitle: w.title, count: w.visits })),
      xpByCategory: [], // Placeholder
      accessBySource: { qr: totalQRScans, app: 0, map: 0, trails: 0 },
      alerts: []
    });

  } catch (err) {
    console.error("Erro dashboard analytics", err);
    return res.status(500).json({ message: "Erro ao carregar dashboard" });
  }
});

// Analytics Avançado (Heatmap, etc)
router.get("/advanced/:tenantId", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { range } = req.query as { range?: string };

    // Calcular data de início baseada no range
    const startDate = new Date();
    switch (range) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30); // Default 30 dias
    }
    startDate.setHours(0, 0, 0, 0);

    // Counts com filtro de data
    const totalVisitors = await prisma.visitor.count({
      where: {
        tenantId,
        createdAt: { gte: startDate }
      }
    });

    const recurringVisitors = await prisma.visitor.count({
      where: {
        tenantId,
        visits: { some: { createdAt: { gte: startDate } } }
      }
    });

    // Visitas por dia no período
    const visitorsByDay = [];
    const daysCount = range === '7d' ? 7 : range === '90d' ? 90 : 30;
    for (let i = daysCount - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(date.getDate() + 1);

      const count = await prisma.visitorVisit.count({
        where: {
          visitor: { tenantId },
          createdAt: { gte: date, lt: nextDate }
        }
      });
      visitorsByDay.push({
        date: date.toLocaleDateString('pt-BR'),
        count
      });
    }

    return res.json({
      totalVisitors,
      recurringVisitors,
      averageAge: 0,
      accessBySource: { qr: 0, app: 0, web: 0 },
      peakHours: [],
      hotWorks: [],
      hotTrails: [],
      hotEvents: [],
      visitorsByAge: [],
      visitorsByDay,
      dateRange: { start: startDate.toISOString(), end: new Date().toISOString() }
    });
  } catch (err) {
    console.error("Erro analytics advanced", err);
    return res.status(500).json({ message: "Erro ao carregar analytics avançado" });
  }
});
// Sales & Ticket Analytics (Sympla Killer Dashboard)
router.get("/sales-summary", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;

    if (!tenantId && user.role !== Role.MASTER) {
      return res.status(400).json({ message: "Tenant obrigatório" });
    }

    // Filter by tenant
    const whereClause: any = {
      event: { tenantId: user.role === Role.MASTER ? undefined : tenantId },
      status: { in: ['CONFIRMED', 'CHECKED_IN'] }
    };

    // Revenue & Sales
    const aggregations = await prisma.registration.aggregate({
      where: whereClause,
      _sum: { pricePaid: true },
      _count: { id: true }
    });

    // Check-in data
    const checkIns = await prisma.registration.count({
      where: {
        ...whereClause,
        status: 'CHECKED_IN'
      }
    });

    return res.json({
      totalRevenue: Number(aggregations._sum.pricePaid) || 0,
      ticketsSold: aggregations._count.id || 0,
      checkInCount: checkIns,
      conversionRate: 0 // Placeholder: requires visit tracking to calc real conversion
    });

  } catch (err) {
    console.error("Erro sales analytics", err);
    return res.status(500).json({ message: "Erro ao buscar métricas de vendas" });
  }
});

export default router;
