/**
 * master-fees.ts — Sprint 15: Central de Taxas da Plataforma
 *
 * Rotas exclusivas para o Master controlar as taxas da plataforma.
 * Todas as rotas exigem Role.MASTER.
 */

import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import {
  Role,
  PlatformFeeSource,
  FeePaidBy,
  AuditAction
} from "@prisma/client";
import {
  getPlatformFee,
  getActiveFeeConfig,
  validateNoOverlap,
  seedDefaultFees,
  FEE_SOURCE_LABELS
} from "../services/fee.service.js";
import { createAuditLog } from "../services/audit.service.js";

const router = Router();

// Todas as rotas exigem autenticação + MASTER
router.use(authMiddleware, requireRole([Role.MASTER]));

// Helper de paginação
function getPagination(req: Request) {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
  const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || "20"), 10)));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// ==========================================
// GET /master/fees/sources
// Lista os tipos de receita disponíveis com labels
// ==========================================
router.get("/sources", (_req: Request, res: Response) => {
  const sources = Object.values(PlatformFeeSource).map((value) => ({
    value,
    label: FEE_SOURCE_LABELS[value] ?? value
  }));
  return res.json({ sources });
});

// ==========================================
// GET /master/fees/overview
// KPIs gerais das taxas da plataforma
// ==========================================
router.get("/overview", async (_req: Request, res: Response) => {
  try {
    const [total, totalActive, tenantSpecific, expiringIn30Days] = await Promise.all([
      prisma.platformFeeConfig.count(),
      prisma.platformFeeConfig.count({ where: { isActive: true } }),
      prisma.platformFeeConfig.count({ where: { isActive: true, tenantId: { not: null } } }),
      prisma.platformFeeConfig.count({
        where: {
          isActive: true,
          endsAt: {
            lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            gte: new Date()
          }
        }
      })
    ]);

    // Média de porcentagem das configs globais ativas
    const globalConfigs = await prisma.platformFeeConfig.findMany({
      where: { isActive: true, tenantId: null },
      select: { sourceType: true, percentage: true, feePaidBy: true }
    });

    const averageGlobalFee = globalConfigs.length > 0
      ? globalConfigs.reduce((sum, c) => sum + Number(c.percentage), 0) / globalConfigs.length
      : 0;

    return res.json({
      total,
      totalActive,
      globalConfigs: totalActive - tenantSpecific,
      tenantSpecific,
      expiringIn30Days,
      averageGlobalFee: Number(averageGlobalFee.toFixed(2)),
      globalFeesBySource: globalConfigs.map((c) => ({
        sourceType: c.sourceType,
        label: FEE_SOURCE_LABELS[c.sourceType],
        percentage: Number(c.percentage),
        feePaidBy: c.feePaidBy
      }))
    });
  } catch (error) {
    console.error("Erro ao buscar overview de taxas:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

// ==========================================
// GET /master/fees/simulate
// Simula a taxa para uma transação
// Query: ?tenantId=&sourceType=&amountCents=
// ==========================================
router.get("/simulate", async (req: Request, res: Response) => {
  try {
    const { tenantId, sourceType, amountCents } = req.query;

    if (!sourceType || !amountCents) {
      return res.status(400).json({ error: "sourceType e amountCents são obrigatórios." });
    }

    if (!Object.values(PlatformFeeSource).includes(sourceType as PlatformFeeSource)) {
      return res.status(400).json({ error: "sourceType inválido." });
    }

    const amount = parseInt(String(amountCents), 10);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "amountCents deve ser um inteiro positivo." });
    }

    const result = await getPlatformFee({
      tenantId: tenantId ? String(tenantId) : null,
      sourceType: sourceType as PlatformFeeSource,
      amountCents: amount
    });

    // Estimativa de taxa Stripe (2.5% + R$ 0.39 = ~2.9% em BRL)
    const STRIPE_RATE = 0.029;
    const STRIPE_FIXED_CENTS = 39;
    const stripeFeeCents = Math.round(result.buyerPaysCents * STRIPE_RATE) + STRIPE_FIXED_CENTS;
    const estimatedNetCents = result.sellerGrossCents - (result.feePaidBy === FeePaidBy.SELLER ? stripeFeeCents : 0);

    // Buscar nome do tenant se fornecido
    let tenantName: string | null = null;
    if (tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: String(tenantId) },
        select: { name: true }
      });
      tenantName = tenant?.name ?? null;
    }

    return res.json({
      ...result,
      sourceLabel: FEE_SOURCE_LABELS[result.sourceType],
      tenantName,
      // Valores monetários formatados (R$)
      baseAmountBRL: (amount / 100).toFixed(2),
      platformFeeBRL: (result.platformFeeCents / 100).toFixed(2),
      buyerPaysBRL: (result.buyerPaysCents / 100).toFixed(2),
      sellerGrossBRL: (result.sellerGrossCents / 100).toFixed(2),
      // Stripe estimativa
      estimatedStripeFeeCents: stripeFeeCents,
      estimatedStripeFeeBRL: (stripeFeeCents / 100).toFixed(2),
      estimatedNetSellerCents: estimatedNetCents,
      estimatedNetSellerBRL: (estimatedNetCents / 100).toFixed(2)
    });
  } catch (error) {
    console.error("Erro ao simular taxa:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

// ==========================================
// GET /master/fees
// Lista todas as configs com paginação e filtros
// Query: ?tenantId=&sourceType=&isActive=&page=&limit=
// ==========================================
router.get("/", async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = getPagination(req);
    const { tenantId, sourceType, isActive, search } = req.query;

    const where: any = {};
    if (tenantId === "global") {
      where.tenantId = null;
    } else if (tenantId) {
      where.tenantId = String(tenantId);
    }
    if (sourceType) where.sourceType = sourceType as PlatformFeeSource;
    if (isActive !== undefined) where.isActive = isActive === "true";
    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: "insensitive" } },
        { notes: { contains: String(search), mode: "insensitive" } }
      ];
    }

    const [configs, total] = await Promise.all([
      prisma.platformFeeConfig.findMany({
        where,
        skip,
        take: limit,
        include: {
          tenant: { select: { id: true, name: true, slug: true } }
        },
        orderBy: [
          { isActive: "desc" },
          { tenantId: "asc" },
          { sourceType: "asc" },
          { priority: "desc" }
        ]
      }),
      prisma.platformFeeConfig.count({ where })
    ]);

    return res.json({
      data: configs.map((c) => ({
        ...c,
        percentage: Number(c.percentage),
        fixedFee: c.fixedFee ? Number(c.fixedFee) : null,
        sourceLabel: FEE_SOURCE_LABELS[c.sourceType]
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error("Erro ao listar configs de taxa:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

// ==========================================
// POST /master/fees
// Cria nova config de taxa
// ==========================================
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      tenantId,
      sourceType,
      name,
      percentage,
      fixedFee,
      feePaidBy,
      isActive,
      startsAt,
      endsAt,
      notes,
      priority
    } = req.body;

    if (!sourceType || percentage === undefined) {
      return res.status(400).json({ error: "sourceType e percentage são obrigatórios." });
    }
    if (!Object.values(PlatformFeeSource).includes(sourceType)) {
      return res.status(400).json({ error: "sourceType inválido." });
    }
    if (isNaN(Number(percentage)) || Number(percentage) < 0 || Number(percentage) > 100) {
      return res.status(400).json({ error: "percentage deve estar entre 0 e 100." });
    }

    // Verificar sobreposição
    const overlap = await validateNoOverlap({
      tenantId: tenantId || null,
      sourceType,
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null
    });

    if (overlap) {
      return res.status(409).json({
        error: "Conflito de vigência",
        message: `Já existe uma config ativa para ${sourceType}${tenantId ? " neste tenant" : " globalmente"} com vigência sobreposta.`,
        conflictingConfig: {
          id: overlap.id,
          name: overlap.name,
          percentage: Number(overlap.percentage),
          startsAt: overlap.startsAt,
          endsAt: overlap.endsAt
        }
      });
    }

    const config = await prisma.platformFeeConfig.create({
      data: {
        tenantId: tenantId || null,
        sourceType,
        name,
        percentage,
        fixedFee: fixedFee || null,
        feePaidBy: feePaidBy || FeePaidBy.SELLER,
        isActive: isActive !== undefined ? isActive : true,
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
        notes,
        priority: priority || 0,
        createdById: req.user?.id
      },
      include: { tenant: { select: { id: true, name: true } } }
    });

    await createAuditLog({
      userId: req.user?.id,
      tenantId: tenantId || null,
      action: AuditAction.CUSTOM,
      entityType: "PlatformFeeConfig",
      entityId: config.id,
      metadata: {
        action: "CREATE_FEE_CONFIG",
        sourceType,
        percentage: Number(percentage),
        feePaidBy: feePaidBy || "SELLER",
        tenantName: config.tenant?.name ?? "Global"
      }
    });

    return res.status(201).json({
      ...config,
      percentage: Number(config.percentage),
      sourceLabel: FEE_SOURCE_LABELS[config.sourceType]
    });
  } catch (error) {
    console.error("Erro ao criar config de taxa:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

// ==========================================
// PATCH /master/fees/:id
// Atualiza config de taxa + AuditLog com diff
// ==========================================
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.platformFeeConfig.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Config de taxa não encontrada." });

    const {
      name,
      percentage,
      fixedFee,
      feePaidBy,
      isActive,
      startsAt,
      endsAt,
      notes,
      priority
    } = req.body;

    // Verificar sobreposição se houve mudança de vigência
    if (startsAt !== undefined || endsAt !== undefined) {
      const overlap = await validateNoOverlap({
        tenantId: existing.tenantId,
        sourceType: existing.sourceType,
        startsAt: startsAt ? new Date(startsAt) : existing.startsAt,
        endsAt: endsAt ? new Date(endsAt) : existing.endsAt,
        excludeId: id
      });

      if (overlap) {
        return res.status(409).json({
          error: "Conflito de vigência",
          message: "A vigência informada sobrepõe outra config ativa.",
          conflictingConfig: { id: overlap.id, name: overlap.name }
        });
      }
    }

    const updated = await prisma.platformFeeConfig.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existing.name,
        percentage: percentage !== undefined ? percentage : existing.percentage,
        fixedFee: fixedFee !== undefined ? fixedFee : existing.fixedFee,
        feePaidBy: feePaidBy !== undefined ? feePaidBy : existing.feePaidBy,
        isActive: isActive !== undefined ? isActive : existing.isActive,
        startsAt: startsAt !== undefined ? (startsAt ? new Date(startsAt) : null) : existing.startsAt,
        endsAt: endsAt !== undefined ? (endsAt ? new Date(endsAt) : null) : existing.endsAt,
        notes: notes !== undefined ? notes : existing.notes,
        priority: priority !== undefined ? priority : existing.priority,
        updatedById: req.user?.id
      },
      include: { tenant: { select: { id: true, name: true } } }
    });

    // AuditLog com diff
    const diff: Record<string, { from: any; to: any }> = {};
    if (percentage !== undefined && Number(percentage) !== Number(existing.percentage)) {
      diff.percentage = { from: Number(existing.percentage), to: Number(percentage) };
    }
    if (feePaidBy !== undefined && feePaidBy !== existing.feePaidBy) {
      diff.feePaidBy = { from: existing.feePaidBy, to: feePaidBy };
    }
    if (isActive !== undefined && isActive !== existing.isActive) {
      diff.isActive = { from: existing.isActive, to: isActive };
    }

    await createAuditLog({
      userId: req.user?.id,
      tenantId: existing.tenantId,
      action: AuditAction.CUSTOM,
      entityType: "PlatformFeeConfig",
      entityId: id,
      metadata: {
        action: "UPDATE_FEE_CONFIG",
        sourceType: existing.sourceType,
        configName: updated.name,
        tenantName: updated.tenant?.name ?? "Global",
        diff
      }
    });

    return res.json({
      ...updated,
      percentage: Number(updated.percentage),
      sourceLabel: FEE_SOURCE_LABELS[updated.sourceType]
    });
  } catch (error) {
    console.error("Erro ao atualizar config de taxa:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

// ==========================================
// DELETE /master/fees/:id
// Desativa config (soft delete via isActive=false)
// ==========================================
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.platformFeeConfig.findUnique({
      where: { id },
      include: { tenant: { select: { name: true } } }
    });
    if (!existing) return res.status(404).json({ error: "Config de taxa não encontrada." });

    await prisma.platformFeeConfig.update({
      where: { id },
      data: { isActive: false, updatedById: req.user?.id }
    });

    await createAuditLog({
      userId: req.user?.id,
      tenantId: existing.tenantId,
      action: AuditAction.CUSTOM,
      entityType: "PlatformFeeConfig",
      entityId: id,
      metadata: {
        action: "DELETE_FEE_CONFIG",
        sourceType: existing.sourceType,
        percentage: Number(existing.percentage),
        tenantName: existing.tenant?.name ?? "Global",
        reason: "Desativação manual pelo Master"
      }
    });

    return res.json({ message: "Config de taxa desativada com sucesso." });
  } catch (error) {
    console.error("Erro ao desativar config de taxa:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

// ==========================================
// GET /master/fees/:id/audit
// Histórico de auditoria de uma config específica
// ==========================================
router.get("/:id/audit", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { page, limit, skip } = getPagination(req);

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: { entityId: id, entityType: "PlatformFeeConfig" },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, name: true, email: true } } }
      }),
      prisma.auditLog.count({ where: { entityId: id, entityType: "PlatformFeeConfig" } })
    ]);

    return res.json({
      data: logs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error("Erro ao buscar auditoria de taxa:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

// ==========================================
// POST /master/fees/seed-defaults
// Seed idempotente das taxas padrão globais
// ==========================================
router.post("/seed-defaults", async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: "Usuário não identificado." });
    }

    const result = await seedDefaultFees(req.user.id);

    await createAuditLog({
      userId: req.user.id,
      tenantId: null,
      action: AuditAction.CUSTOM,
      entityType: "PlatformFeeConfig",
      entityId: "seed-defaults",
      metadata: {
        action: "SEED_DEFAULT_FEES",
        created: result.created,
        skipped: result.skipped,
        details: result.details
      }
    });

    return res.json({
      message: `Seed concluído: ${result.created} criadas, ${result.skipped} ignoradas.`,
      ...result
    });
  } catch (error) {
    console.error("Erro ao fazer seed de taxas:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

export default router;
