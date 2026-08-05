import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { parsePagination, sendOk, sendPaginated } from "../../utils/apiResponse.js";

const router = Router();

const STATE_REGIONS: Record<string, string> = {
  AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
  AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste", PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
  DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
  ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
  PR: "Sul", RS: "Sul", SC: "Sul"
};

function normalizeState(state?: string | null) {
  return (state || "NA").trim().toUpperCase() || "NA";
}

function regionForState(state?: string | null) {
  return STATE_REGIONS[normalizeState(state)] || "Nao informado";
}

function toStringParam(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function publicEventWhere(query: Record<string, unknown>): Prisma.EventWhereInput {
  const city = toStringParam(query.city);
  const state = toStringParam(query.state);
  const from = toStringParam(query.from);
  const to = toStringParam(query.to);

  return {
    deletedAt: null,
    visibility: "PUBLIC",
    status: { in: ["PUBLISHED", "ACTIVE", "APPROVED"] },
    ...(city ? { city: { contains: city, mode: "insensitive" } } : {}),
    ...(state ? { state: { equals: state, mode: "insensitive" } } : {}),
    ...((from || to) ? {
      startDate: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {})
      }
    } : {})
  };
}

router.get("/indicators", async (req, res) => {
  const [tenants, equipments, works, events, registrations, visits, cityGroups, stateGroups] = await Promise.all([
    prisma.tenant.count({ where: { deletedAt: null } }),
    prisma.equipamentoCultural.count({ where: { ativo: true } }),
    prisma.work.count({ where: { published: true, deletedAt: null } }),
    prisma.event.count({ where: publicEventWhere(req.query) }),
    prisma.registration.count({ where: { deletedAt: null } }),
    prisma.visitorVisit.count(),
    prisma.equipamentoCultural.groupBy({
      by: ["cidade", "estado"],
      where: { ativo: true },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: 100
    }),
    prisma.equipamentoCultural.groupBy({
      by: ["estado"],
      where: { ativo: true },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } }
    })
  ]);

  const byCity = cityGroups.map(item => ({
    city: item.cidade,
    state: normalizeState(item.estado),
    region: regionForState(item.estado),
    equipments: item._count._all
  }));

  const byState = stateGroups.map(item => ({
    state: normalizeState(item.estado),
    region: regionForState(item.estado),
    equipments: item._count._all
  }));

  const byRegion = byState.reduce<Record<string, { region: string; equipments: number }>>((acc, item) => {
    acc[item.region] ||= { region: item.region, equipments: 0 };
    acc[item.region].equipments += item.equipments;
    return acc;
  }, {});

  return sendOk(res, {
    totals: { tenants, equipments, works, events, registrations, visits },
    byCity,
    byState,
    byRegion: Object.values(byRegion).sort((a, b) => b.equipments - a.equipments)
  });
});

router.get("/rankings/equipments", async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req.query);

  const [total, equipments] = await Promise.all([
    prisma.equipamentoCultural.count({ where: { ativo: true } }),
    prisma.equipamentoCultural.findMany({
      where: { ativo: true },
      skip,
      take,
      include: {
        _count: {
          select: {
            equipamentoCheckins: true,
            works: true,
            events: true,
            trails: true
          }
        },
        tenant: {
          select: { id: true, slug: true, name: true, logoUrl: true }
        }
      },
      orderBy: [
        { equipamentoCheckins: { _count: "desc" } },
        { nome: "asc" }
      ]
    })
  ]);

  return sendPaginated(res, equipments.map(item => ({
    id: item.id,
    name: item.nome,
    slug: item.slug,
    type: item.tipo,
    city: item.cidade,
    state: normalizeState(item.estado),
    region: regionForState(item.estado),
    coverUrl: item.fotoCapaUrl,
    tenant: item.tenant,
    visits: item._count.equipamentoCheckins,
    works: item._count.works,
    events: item._count.events,
    trails: item._count.trails
  })), total, page, pageSize);
});

router.get("/map", async (req, res) => {
  const state = toStringParam(req.query.state);
  const city = toStringParam(req.query.city);

  const equipments = await prisma.equipamentoCultural.findMany({
    where: {
      ativo: true,
      lat: { not: null },
      lng: { not: null },
      ...(state ? { estado: { equals: state, mode: "insensitive" } } : {}),
      ...(city ? { cidade: { contains: city, mode: "insensitive" } } : {})
    },
    take: 500,
    orderBy: { nome: "asc" },
    select: {
      id: true,
      nome: true,
      slug: true,
      tipo: true,
      cidade: true,
      estado: true,
      lat: true,
      lng: true,
      fotoCapaUrl: true,
      acessivelAudio: true,
      acessivelCadeira: true,
      acessivelLibras: true
    }
  });

  return sendOk(res, equipments.map(item => ({
    id: item.id,
    name: item.nome,
    slug: item.slug,
    type: item.tipo,
    city: item.cidade,
    state: normalizeState(item.estado),
    region: regionForState(item.estado),
    lat: item.lat,
    lng: item.lng,
    coverUrl: item.fotoCapaUrl,
    accessibility: {
      audio: item.acessivelAudio,
      wheelchair: item.acessivelCadeira,
      libras: item.acessivelLibras
    }
  })));
});

router.get("/search", async (req, res) => {
  const q = toStringParam(req.query.q);
  const { pageSize } = parsePagination(req.query, { page: 1, pageSize: 10, maxPageSize: 25 });

  if (q.length < 2) {
    return sendOk(res, { query: q, results: [] });
  }

  const contains = { contains: q, mode: "insensitive" as const };
  const [equipments, works, events, providers, cities] = await Promise.all([
    prisma.equipamentoCultural.findMany({
      where: { ativo: true, OR: [{ nome: contains }, { cidade: contains }, { tipo: contains }] },
      take: pageSize,
      select: { id: true, nome: true, slug: true, tipo: true, cidade: true, estado: true, fotoCapaUrl: true }
    }),
    prisma.work.findMany({
      where: { published: true, deletedAt: null, OR: [{ title: contains }, { artist: contains }, { description: contains }] },
      take: pageSize,
      select: { id: true, title: true, artist: true, imageUrl: true, tenantId: true }
    }),
    prisma.event.findMany({
      where: { ...publicEventWhere(req.query), OR: [{ title: contains }, { description: contains }, { city: contains }] },
      take: pageSize,
      select: { id: true, title: true, startDate: true, city: true, state: true, coverImageUrl: true, coverUrl: true, tenantId: true }
    }),
    prisma.serviceProvider.findMany({
      where: { active: true, OR: [{ name: contains }, { description: contains }] },
      take: pageSize,
      select: { id: true, name: true, type: true, coverUrl: true, tenantId: true }
    }),
    prisma.equipamentoCultural.groupBy({
      by: ["cidade", "estado"],
      where: { ativo: true, cidade: contains },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: pageSize
    })
  ]);

  return sendOk(res, {
    query: q,
    results: [
      ...equipments.map(item => ({ type: "equipment", id: item.id, title: item.nome, subtitle: `${item.tipo} - ${item.cidade}/${normalizeState(item.estado)}`, imageUrl: item.fotoCapaUrl, url: `/equipamentos/${item.slug}` })),
      ...works.map(item => ({ type: "work", id: item.id, title: item.title, subtitle: item.artist, imageUrl: item.imageUrl, tenantId: item.tenantId, url: `/works/${item.id}` })),
      ...events.map(item => ({ type: "event", id: item.id, title: item.title, subtitle: item.city ? `${item.city}/${normalizeState(item.state)}` : "Evento", imageUrl: item.coverImageUrl || item.coverUrl, tenantId: item.tenantId, url: `/events/${item.id}` })),
      ...providers.map(item => ({ type: "provider", id: item.id, title: item.name, subtitle: item.type, imageUrl: item.coverUrl, tenantId: item.tenantId, url: `/providers/${item.id}` })),
      ...cities.map(item => ({ type: "city", id: `${item.cidade}-${item.estado}`, title: item.cidade, subtitle: `${normalizeState(item.estado)} - ${item._count._all} equipamentos`, url: `/cidades/${encodeURIComponent(item.cidade)}` }))
    ]
  });
});

router.get("/digital-collections", async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req.query);
  const q = toStringParam(req.query.q);
  const where: Prisma.WorkWhereInput = {
    published: true,
    deletedAt: null,
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { artist: { contains: q, mode: "insensitive" } }] } : {})
  };

  const [total, works] = await Promise.all([
    prisma.work.count({ where }),
    prisma.work.findMany({
      where,
      skip,
      take,
      orderBy: { updatedAt: "desc" },
      include: {
        tenant: { select: { id: true, name: true, slug: true, logoUrl: true } },
        equipamentoCultural: { select: { id: true, nome: true, cidade: true, estado: true } }
      }
    })
  ]);

  return sendPaginated(res, works.map(item => ({
    id: item.id,
    title: item.title,
    artist: item.artist,
    year: item.year,
    imageUrl: item.imageUrl,
    audioUrl: item.audioUrl,
    librasUrl: item.librasUrl,
    videoUrl: item.videoUrl,
    tenant: item.tenant,
    equipment: item.equipamentoCultural
  })), total, page, pageSize);
});

router.get("/services", async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req.query);
  const type = toStringParam(req.query.type);
  const q = toStringParam(req.query.q);

  const where: Prisma.ServiceProviderWhereInput = {
    active: true,
    ...(type ? { type: type as any } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] } : {})
  };

  const [total, providers] = await Promise.all([
    prisma.serviceProvider.count({ where }),
    prisma.serviceProvider.findMany({
      where,
      skip,
      take,
      orderBy: [{ verified: "desc" }, { name: "asc" }],
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            equipamentoCulturals: {
              select: { cidade: true, estado: true },
              take: 1
            }
          }
        },
        _count: { select: { bookings: true, providerReviews: true } }
      }
    })
  ]);

  return sendPaginated(res, providers.map(item => {
    const equipment = item.tenant.equipamentoCulturals[0];
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      description: item.description,
      verified: item.verified,
      coverUrl: item.coverUrl,
      city: equipment?.cidade || null,
      state: equipment?.estado ? normalizeState(equipment.estado) : null,
      region: regionForState(equipment?.estado),
      tenant: { id: item.tenant.id, name: item.tenant.name, slug: item.tenant.slug },
      stats: {
        bookings: item._count.bookings,
        reviews: item._count.providerReviews
      }
    };
  }), total, page, pageSize);
});

router.get("/events", async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req.query);
  const where = publicEventWhere(req.query);

  const [total, events] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      skip,
      take,
      orderBy: { startDate: "asc" },
      include: {
        tenant: { select: { id: true, name: true, slug: true, logoUrl: true } },
        _count: { select: { registrations: true } }
      }
    })
  ]);

  return sendPaginated(res, events.map(item => ({
    id: item.id,
    title: item.title,
    description: item.description,
    startDate: item.startDate,
    endDate: item.endDate,
    city: item.city,
    state: normalizeState(item.state),
    region: regionForState(item.state),
    coverUrl: item.coverImageUrl || item.coverUrl,
    tenant: item.tenant,
    registrations: item._count.registrations
  })), total, page, pageSize);
});

export default router;
