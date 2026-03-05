import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// Resumo geral para MASTER
router.get("/tenants-summary", authMiddleware, requireRole([Role.MASTER]), async (_req, res) => {
  try {
    const [tenants, visitCounts] = await Promise.all([
      prisma.tenant.findMany({
        include: {
          _count: {
            select: { works: true, trails: true, events: true, visitors: true }
          }
        }
      }),
      prisma.visitorVisit.groupBy({
        by: ['visitorId'],
        _count: { id: true },
        // This group by visitorId doesn't give me tenantId directly unless I join.
        // Prisma groupBy doesn't support relations.
        // Alternative: Fetch all visits? No, too heavy.
        // Better: QueryRaw or just keep N+1 if N (tenants) is small? 
        // Tenants list is usually small (< 100). But "Resolva tudo" implies best practice.
        // Best approach: 
        // Use a Raw Query to count visits per tenant.
      })
    ]);

    // OPTIMIZED STRATEGY: 
    // Since we need to join visitor -> tenant to count visits per tenant.
    const visitsPerTenant = await prisma.visitor.groupBy({
      by: ['tenantId'],
      _sum: { xp: true }, // just incidental
      _count: { id: true }
      // Wait, visitor.count is just visitors. I need VISITS.
    });

    // To count visits per tenant efficiently:
    // We can use a raw query: SELECT "Visitor"."tenantId", COUNT("VisitorVisit"."id") as "visits" FROM "Visitor" JOIN "VisitorVisit" ON "Visitor"."id" = "VisitorVisit"."visitorId" GROUP BY "Visitor"."tenantId"
    const rawVisits = await prisma.$queryRaw`
      SELECT v."tenantId", COUNT(vv.id) as visits 
      FROM "Visitor" v 
      JOIN "VisitorVisit" vv ON v.id = vv."visitorId" 
      GROUP BY v."tenantId"
    ` as { tenantId: string, visits: bigint }[];

    const visitMap = new Map<string, number>();
    rawVisits.forEach(r => visitMap.set(r.tenantId, Number(r.visits)));

    const data = tenants.map((t) => ({
      tenantId: t.id,
      name: t.name,
      works: t._count.works,
      trails: t._count.trails,
      events: t._count.events,
      visitors: t._count.visitors,
      visits: visitMap.get(t.id) || 0
    }));

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

    const [tenant, visitsCount] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          _count: {
            select: { works: true, trails: true, events: true, visitors: true }
          }
        }
      }),
      prisma.visitorVisit.count({
        where: { visitor: { tenantId } }
      })
    ]);

    if (!tenant) {
      return res.status(404).json({ message: "Tenant não encontrado" });
    }

    return res.json({
      tenantId: tenant.id,
      name: tenant.name,
      works: tenant._count.works,
      trails: tenant._count.trails,
      events: tenant._count.events,
      visitors: tenant._count.visitors,
      visits: visitsCount
    });
  } catch (err) {
    console.error("Erro analytics tenant", err);
    return res.status(500).json({ message: "Erro ao carregar analytics" });
  }
});

// Obras populares (Optimized - No changes needed, already efficient groupBy)
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
    // Parallel fetch works
    const workIds = popular.map(p => p.workId).filter((id): id is string => !!id);
    const works = await prisma.work.findMany({
      where: { id: { in: workIds } },
      select: { id: true, title: true }
    });

    const enriched = popular.map(p => {
      const w = works.find(work => work.id === p.workId);
      return {
        workId: p.workId,
        title: w?.title || "Desconhecido",
        visits: p._count.workId
      };
    });

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
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Run parallel queries
    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Fetch visitor ids first to avoid Prisma relation-in-groupBy limitations
    const visitors = await prisma.visitor.findMany({ where: { tenantId }, select: { id: true } });
    const visitorsInTenant = visitors.map(v => v.id);

    if (visitorsInTenant.length === 0) {
      return res.json({
        visitorsThisMonth: 0,
        topWorks: [],
        topTrails: [],
        topEvents: [],
        totalQRScans: 0,
        totalXPDistributed: 0,
        weeklyGrowth: 0,
        monthlyGrowth: 0,
        visitsByDay: [],
        visitsByWork: [],
        xpByCategory: [],
        accessBySource: { qr: 0, app: 0, map: 0, trails: 0 },
        upcomingBookings: [],
        alerts: []
      });
    }

    const [
      visitorsThisMonth,
      visitorsPrevMonth,
      visitsLast7Days,
      visitsPrev7Days,
      topWorksRaw,
      topTrailsRaw,
      topEventsRaw,
      totalQRScans,
      totalXP,
      xpByCategoryRaw,
      sourceStatsRaw,
      rawIntervals,
      upcomingBookings
    ] = await Promise.all([
      prisma.visitorVisit.count({
        where: { visitorId: { in: visitorsInTenant }, createdAt: { gte: startOfCurrentMonth } }
      }),
      prisma.visitorVisit.count({
        where: { visitorId: { in: visitorsInTenant }, createdAt: { gte: startOfPrevMonth, lt: startOfCurrentMonth } }
      }),
      prisma.visitorVisit.count({
        where: { visitorId: { in: visitorsInTenant }, createdAt: { gte: sevenDaysAgo } }
      }),
      prisma.visitorVisit.count({
        where: { visitorId: { in: visitorsInTenant }, createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } }
      }),
      prisma.visitorVisit.groupBy({
        by: ["workId"],
        where: { workId: { not: null }, visitorId: { in: visitorsInTenant } },
        _count: { workId: true },
        orderBy: { _count: { workId: "desc" } },
        take: 5
      }),
      prisma.visitorVisit.groupBy({
        by: ["trailId"],
        where: { trailId: { not: null }, visitorId: { in: visitorsInTenant } },
        _count: { trailId: true },
        orderBy: { _count: { trailId: "desc" } },
        take: 5
      }),
      prisma.visitorVisit.groupBy({
        by: ["eventId"],
        where: { eventId: { not: null }, visitorId: { in: visitorsInTenant } },
        _count: { eventId: true },
        orderBy: { _count: { eventId: "desc" } },
        take: 5
      }),
      prisma.visitorVisit.count({
        where: { visitorId: { in: visitorsInTenant }, source: "QR" }
      }),
      prisma.visitor.aggregate({
        where: { tenantId },
        _sum: { xp: true }
      }),
      // XP by Category (Work Category)
      prisma.$queryRaw`
        SELECT c.name as category, SUM(vv."xpGained") as xp
        FROM "VisitorVisit" vv
        JOIN "Work" w ON vv."workId" = w.id
        JOIN "Category" c ON w."categoryId" = c.id
        WHERE w."tenantId" = ${tenantId}
        GROUP BY c.name
      ` as Promise<{ category: string, xp: bigint | null }[]>,
      // Source Distribution
      prisma.visitorVisit.groupBy({
        by: ["source"],
        where: { visitorId: { in: visitorsInTenant } },
        _count: { id: true }
      }),
      // Optimized 7-day query using raw SQL for Postgres
      prisma.$queryRaw`
        SELECT DATE("createdAt") as date, COUNT(*) as count 
        FROM "VisitorVisit" 
        WHERE "visitorId" IN (SELECT id FROM "Visitor" WHERE "tenantId" = ${tenantId})
          AND "createdAt" >= NOW() - INTERVAL '7 days'
        GROUP BY DATE("createdAt")
        ORDER BY DATE("createdAt") ASC
      ` as Promise<{ date: Date | string, count: bigint }[]>,
      // Upcoming Space Bookings
      prisma.booking.findMany({
        where: {
          tenantId,
          spaceId: { not: null },
          startTime: { gte: new Date() },
          status: { not: "CANCELLED" }
        },
        include: {
          space: { select: { name: true, type: true } },
          user: { select: { name: true } }
        },
        orderBy: { startTime: "asc" },
        take: 5
      })
    ]);

    // Enrich Top Works
    const workIds = topWorksRaw.map(p => p.workId).filter((id): id is string => !!id);
    const works = await prisma.work.findMany({ where: { id: { in: workIds } }, select: { id: true, title: true } });
    const topWorks = topWorksRaw.map(p => ({
      id: p.workId!,
      title: works.find(w => w.id === p.workId)?.title || "Desconhecido",
      visits: (p._count as any)?.workId || 0
    }));

    // Enrich Top Trails
    const trailIds = topTrailsRaw.map(p => p.trailId).filter((id): id is string => !!id);
    const trails = await prisma.trail.findMany({ where: { id: { in: trailIds } }, select: { id: true, title: true } });
    const topTrails = topTrailsRaw.map(p => ({
      id: p.trailId!,
      title: trails.find(t => t.id === p.trailId)?.title || "Desconhecido",
      completions: (p._count as any)?.trailId || 0
    }));

    // Enrich Top Events
    const eventIds = topEventsRaw.map(p => p.eventId).filter((id): id is string => !!id);
    const events = await prisma.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, title: true } });
    const topEvents = topEventsRaw.map(p => ({
      id: p.eventId!,
      title: events.find(e => e.id === p.eventId)?.title || "Desconhecido",
      views: (p._count as any)?.eventId || 0
    }));

    // Calculate Growths
    const calcGrowth = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 100);
    };

    const weeklyGrowth = calcGrowth(visitsLast7Days, visitsPrev7Days);
    const monthlyGrowth = calcGrowth(visitorsThisMonth, visitorsPrevMonth);

    // Process Date Buckets
    const map = new Map<string, number>();
    (await rawIntervals).forEach(r => {
      // Postgres returns Date object or string depending on driver config
      const d = r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date);
      map.set(d, Number(r.count));
    });

    const visitsByDay = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().split('T')[0];
      visitsByDay.push({
        date: d.toLocaleDateString('pt-BR', { weekday: 'short' }),
        count: map.get(iso) || 0
      });
    }

    // Process XP by Category
    const xpByCategory = (await xpByCategoryRaw).map(item => ({
      category: item.category,
      xp: item.xp ? Number(item.xp) : 0
    }));

    // Process Source Stats
    const accessBySource = { qr: 0, app: 0, map: 0, trails: 0 };
    sourceStatsRaw.forEach(s => {
      if (s.source === "QR") accessBySource.qr = s._count.id;
      else if (s.source === "APP") accessBySource.app = s._count.id;
      else if (s.source === "MAP") accessBySource.map = s._count.id;
      else if (s.source === "TRAIL") accessBySource.trails = s._count.id;
    });

    return res.json({
      visitorsThisMonth,
      topWorks,
      topTrails,
      topEvents,
      totalQRScans,
      totalXPDistributed: totalXP._sum.xp || 0,
      weeklyGrowth,
      monthlyGrowth,
      visitsByDay,
      visitsByWork: topWorks.map(w => ({ workTitle: w.title, count: w.visits })),
      xpByCategory,
      accessBySource,
      upcomingBookings,
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

    const startDate = new Date();
    const days = range === '90d' ? 90 : range === '7d' ? 7 : 30; // 30 is default
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const [
      totalVisitors,
      recurringVisitors,
      rawDaily,
      avgAgeResult,
      sourceStats,
      peakHoursRaw,
      hotWorksRaw,
      hotTrailsRaw,
      hotEventsRaw,
      ageDistributionRaw
    ] = await Promise.all([
      prisma.visitor.count({ where: { tenantId, createdAt: { gte: startDate } } }),
      prisma.visitor.count({ where: { tenantId, visits: { some: { createdAt: { gte: startDate } } } } }),
      // Daily Visits
      prisma.$queryRaw`
        SELECT DATE("createdAt") as date, COUNT(*) as count 
        FROM "VisitorVisit" 
        WHERE "visitorId" IN (SELECT id FROM "Visitor" WHERE "tenantId" = ${tenantId})
          AND "createdAt" >= ${startDate}
        GROUP BY DATE("createdAt")
        ORDER BY DATE("createdAt") ASC
      ` as Promise<{ date: Date | string, count: bigint }[]>,
      // Average Age
      prisma.visitor.aggregate({
        where: { tenantId, age: { not: null } },
        _avg: { age: true }
      }),
      // Access Source
      prisma.visitorVisit.groupBy({
        by: ['source'],
        where: { visitor: { tenantId }, createdAt: { gte: startDate } },
        _count: { id: true }
      }),
      // Peak Hours (Postgres)
      prisma.$queryRaw`
         SELECT EXTRACT(HOUR FROM "createdAt") as hour, COUNT(*) as count
         FROM "VisitorVisit"
         WHERE "visitorId" IN (SELECT id FROM "Visitor" WHERE "tenantId" = ${tenantId})
           AND "createdAt" >= ${startDate}
         GROUP BY EXTRACT(HOUR FROM "createdAt")
         ORDER BY hour ASC
      ` as Promise<{ hour: number, count: bigint }[]>,
      // Hot Works
      prisma.visitorVisit.groupBy({
        by: ['workId'],
        where: { visitor: { tenantId }, workId: { not: null }, createdAt: { gte: startDate } },
        _count: { workId: true },
        orderBy: { _count: { workId: 'desc' } },
        take: 5
      }),
      // Hot Trails
      prisma.visitorVisit.groupBy({
        by: ['trailId'],
        where: { visitor: { tenantId }, trailId: { not: null }, createdAt: { gte: startDate } },
        _count: { trailId: true },
        orderBy: { _count: { trailId: 'desc' } },
        take: 3
      }),
      // Hot Events
      prisma.visitorVisit.groupBy({
        by: ['eventId'],
        where: { visitor: { tenantId }, eventId: { not: null }, createdAt: { gte: startDate } },
        _count: { eventId: true },
        orderBy: { _count: { eventId: 'desc' } },
        take: 3
      }),
      // Age Distribution
      prisma.visitor.groupBy({
        by: ['age'],
        where: { tenantId, age: { not: null } },
        _count: { id: true },
        orderBy: { age: 'asc' }
      })
    ]);

    // Process Date Map
    const dateMap = new Map<string, number>();
    (await rawDaily).forEach(r => {
      const d = r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date);
      dateMap.set(d, Number(r.count));
    });

    const visitorsByDay = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().split('T')[0];
      visitorsByDay.push({
        date: d.toLocaleDateString('pt-BR'),
        count: dateMap.get(iso) || 0
      });
    }

    // Process Source
    const accessBySource = { qr: 0, app: 0, web: 0 };
    sourceStats.forEach(s => {
      if (s.source === 'QR') accessBySource.qr = s._count.id;
      else if (s.source === 'APP') accessBySource.app = s._count.id;
      else accessBySource.web += s._count.id; // Others/Null assumed web/direct
    });

    // Process Peak Hours
    const peakHours = peakHoursRaw.map(p => ({
      hour: `${p.hour}:00`,
      count: Number(p.count)
    }));

    // Enrich Hot Items
    const [hotWorks, hotTrails, hotEvents] = await Promise.all([
      (async () => {
        const ids = hotWorksRaw.map(i => i.workId!).filter(Boolean);
        const details = await prisma.work.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } });
        return hotWorksRaw.map(i => ({
          id: i.workId,
          title: details.find(w => w.id === i.workId)?.title || "Desconhecido",
          heat: Math.round((i._count.workId / Math.max(...hotWorksRaw.map(x => x._count.workId), 1)) * 100)
        }));
      })(),
      (async () => {
        const ids = hotTrailsRaw.map(i => i.trailId!).filter(Boolean);
        const details = await prisma.trail.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } });
        return hotTrailsRaw.map(i => ({
          id: i.trailId,
          title: details.find(t => t.id === i.trailId)?.title || "Desconhecido",
          heat: Math.round((i._count.trailId / Math.max(...hotTrailsRaw.map(x => x._count.trailId), 1)) * 100)
        }));
      })(),
      (async () => {
        const ids = hotEventsRaw.map(i => i.eventId!).filter(Boolean);
        const details = await prisma.event.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } });
        return hotEventsRaw.map(i => ({
          id: i.eventId,
          title: details.find(e => e.id === i.eventId)?.title || "Desconhecido",
          heat: Math.round((i._count.eventId / Math.max(...hotEventsRaw.map(x => x._count.eventId), 1)) * 100)
        }));
      })()
    ]);

    // Process Age Distribution (Bucketize)
    const ageGroups = { '0-18': 0, '19-24': 0, '25-34': 0, '35-44': 0, '45-60': 0, '60+': 0 };
    ageDistributionRaw.forEach(group => {
      const age = group.age;
      const count = group._count.id;
      if (!age) return;

      if (age <= 18) ageGroups['0-18'] += count;
      else if (age <= 24) ageGroups['19-24'] += count;
      else if (age <= 34) ageGroups['25-34'] += count;
      else if (age <= 44) ageGroups['35-44'] += count;
      else if (age <= 60) ageGroups['45-60'] += count;
      else ageGroups['60+'] += count;
    });

    const visitorsByAge = Object.entries(ageGroups).map(([range, count]) => ({ range, count }));

    return res.json({
      totalVisitors,
      recurringVisitors,
      averageAge: Math.round(avgAgeResult._avg.age || 0),
      accessBySource,
      peakHours,
      hotWorks,
      hotTrails,
      hotEvents,
      visitorsByAge,
      visitorsByDay,
      dateRange: { start: startDate.toISOString(), end: new Date().toISOString() }
    });
  } catch (err) {
    console.error("Erro analytics advanced", err);
    return res.status(500).json({ message: "Erro ao carregar analytics avançado" });
  }
});
// Accessibility Summary (for Producer Reports)
router.get("/accessibility-summary", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), async (req, res) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;

    if (!tenantId && user.role !== Role.MASTER) {
      return res.status(400).json({ message: "Tenant obrigatório" });
    }

    const whereClause = tenantId ? { tenantId } : {};

    const [executions, requests] = await Promise.all([
      prisma.accessibilityExecution.count({ where: whereClause }),
      prisma.accessibilityRequest.count({ where: whereClause })
    ]);

    return res.json({ executions, requests });
  } catch (err) {
    console.error("Erro accessibility summary", err);
    return res.status(500).json({ message: "Erro ao buscar resumo de acessibilidade" });
  }
});

// Sales & Ticket Analytics (Sympla Killer Dashboard)
router.get("/sales-summary", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), async (req, res) => {
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

    // Raised Amount (Valor Captado) from Cultural Projects
    const raisedAgg = await prisma.culturalProject.aggregate({
      where: {
        tenantId: user.role === Role.MASTER ? undefined : (tenantId || undefined),
        status: { in: ['APPROVED', 'IN_EXECUTION', 'COMPLETED'] }
      },
      _sum: { approvedBudget: true }
    });

    // Conversion Rate: (Confirmed Tickets) / (Unique Visitors in same period)
    const uniqueVisitorsCount = await prisma.visitorVisit.groupBy({
      by: ['visitorId'],
      where: { visitor: { tenantId: user.role === Role.MASTER ? undefined : (tenantId || undefined) } }
    }).then(res => res.length);

    const conversionRate = uniqueVisitorsCount > 0
      ? Math.round((aggregations._count.id / uniqueVisitorsCount) * 100)
      : 0;

    return res.json({
      totalRevenue: Number(aggregations._sum.pricePaid || 0),
      raisedAmount: Number(raisedAgg._sum?.approvedBudget || 0),
      ticketsSold: aggregations._count.id || 0,
      checkInCount: checkIns,
      conversionRate
    });

  } catch (err) {
    console.error("Erro sales analytics", err);
    return res.status(500).json({ message: "Erro ao buscar métricas de vendas" });
  }
});

// Heatmap — QR scan / visit frequency by room and work
router.get("/heatmap", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const user = req.user!;
    const tenantId = (req.query.tenantId as string) || user.tenantId;
    const days = parseInt(req.query.days as string) || 30;

    if (!tenantId) {
      return res.status(400).json({ message: "tenantId obrigatório" });
    }

    const since = new Date();
    since.setDate(since.getDate() - days);

    // Count visits per work with room info
    const visits = await prisma.visitorVisit.groupBy({
      by: ['workId'],
      where: {
        workId: { not: null },
        visitor: { tenantId },
        createdAt: { gte: since }
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } }
    });

    // Fetch work details
    const workIds = visits.map(v => v.workId).filter(Boolean) as string[];
    const works = await prisma.work.findMany({
      where: { id: { in: workIds } },
      select: { id: true, title: true, room: true, floor: true, imageUrl: true }
    });

    const workMap = new Map(works.map(w => [w.id, w]));

    const heatmapData = visits.map(v => {
      const work = workMap.get(v.workId!);
      return {
        workId: v.workId,
        title: work?.title || 'Desconhecido',
        room: work?.room || 'Sem sala',
        floor: work?.floor || '0',
        visits: v._count.id,
        imageUrl: work?.imageUrl
      };
    });

    // Aggregate by room
    const roomMap = new Map<string, { visits: number; works: number }>();
    heatmapData.forEach(h => {
      const existing = roomMap.get(h.room) || { visits: 0, works: 0 };
      existing.visits += h.visits;
      existing.works++;
      roomMap.set(h.room, existing);
    });

    const byRoom = Array.from(roomMap.entries())
      .map(([room, data]) => ({ room, ...data }))
      .sort((a, b) => b.visits - a.visits);

    return res.json({
      period: { days, since: since.toISOString() },
      totalVisits: heatmapData.reduce((sum, h) => sum + h.visits, 0),
      byWork: heatmapData.slice(0, 30),
      byRoom
    });
  } catch (err) {
    console.error("Error generating heatmap:", err);
    return res.status(500).json({ message: "Erro ao gerar heatmap" });
  }
});

// Funnel — Conversion funnel analytics
router.get("/funnel", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const user = req.user!;
    const tenantId = (req.query.tenantId as string) || user.tenantId;
    const days = parseInt(req.query.days as string) || 30;

    if (!tenantId) {
      return res.status(400).json({ message: "tenantId obrigatório" });
    }

    const since = new Date();
    since.setDate(since.getDate() - days);

    // Stage 1: Total visitors (registered)
    const totalVisitors = await prisma.visitor.count({
      where: { tenantId, createdAt: { gte: since } }
    });

    // Stage 2: Visitors who scanned at least 1 QR / made a visit
    const activeVisitors = await prisma.visitorVisit.groupBy({
      by: ['visitorId'],
      where: { visitor: { tenantId }, createdAt: { gte: since } }
    }).then(r => r.length);

    // Stage 3: Visitors who registered for an event
    const eventRegistrants = await prisma.registration.groupBy({
      by: ['guestEmail'],
      where: { event: { tenantId }, createdAt: { gte: since } }
    }).then(r => r.length);

    // Stage 4: Visitors who bought from shop
    const shopBuyers = await prisma.order.count({
      where: { tenantId, createdAt: { gte: since }, status: { not: 'CANCELLED' } }
    });

    // Stage 5: Returning visitors (2+ visits in different days)
    const returningVisitors = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT vv."visitorId") as count
      FROM "VisitorVisit" vv
      JOIN "Visitor" v ON v.id = vv."visitorId"
      WHERE v."tenantId" = ${tenantId}
        AND vv."createdAt" >= ${since}
      GROUP BY vv."visitorId"
      HAVING COUNT(DISTINCT DATE(vv."createdAt")) >= 2
    `.then((r: any) => r.length).catch(() => 0);

    const funnel = [
      { stage: 'Cadastrados', count: totalVisitors, pct: 100 },
      { stage: 'Ativos (escanearam QR)', count: activeVisitors, pct: totalVisitors > 0 ? Math.round((activeVisitors / totalVisitors) * 100) : 0 },
      { stage: 'Inscritos em evento', count: eventRegistrants, pct: totalVisitors > 0 ? Math.round((eventRegistrants / totalVisitors) * 100) : 0 },
      { stage: 'Compraram na loja', count: shopBuyers, pct: totalVisitors > 0 ? Math.round((shopBuyers / totalVisitors) * 100) : 0 },
      { stage: 'Retornaram (2+ visitas)', count: returningVisitors, pct: totalVisitors > 0 ? Math.round((returningVisitors / totalVisitors) * 100) : 0 }
    ];

    return res.json({ period: { days }, funnel });
  } catch (err) {
    console.error("Error generating funnel:", err);
    return res.status(500).json({ message: "Erro ao gerar funil" });
  }
});

export default router;
