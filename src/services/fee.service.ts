/**
 * fee.service.ts — Sprint 15: Central de Taxas da Plataforma
 *
 * Serviço central de resolução de taxas da plataforma.
 * Prioridade de resolução:
 *   1. Config específica do tenant (tenantId + sourceType, ativa, em vigência)
 *   2. Config global (tenantId null + sourceType, ativa, em vigência)
 *   3. Fallback seguro do sistema (5%, SELLER)
 *
 * NUNCA use taxas hardcoded fora deste arquivo.
 */

import { prisma } from "../prisma.js";
import { PlatformFeeSource, FeePaidBy } from "@prisma/client";

// ==========================================
// TIPOS
// ==========================================

export interface FeeCalculationInput {
  tenantId: string | null | undefined;
  sourceType: PlatformFeeSource;
  amountCents: number;
}

export interface FeeCalculationResult {
  configId: string | null;
  sourceType: PlatformFeeSource;
  percentage: number;          // Ex: 5.0 (representa 5%)
  fixedFeeCents: number;       // Taxa fixa em centavos
  platformFeeCents: number;    // Taxa total da plataforma em centavos
  feePaidBy: FeePaidBy;

  // Contexto financeiro expandido
  baseAmountCents: number;     // Valor original
  buyerPaysCents: number;      // O que o comprador desembolsa
  sellerGrossCents: number;    // O que o recebedor recebe antes de taxas de gateway
  
  // Diagnóstico
  isTenantSpecific: boolean;
  appliedRule: "TENANT" | "GLOBAL" | "FALLBACK";
}

export interface ProviderSubscriptionPricing {
  configId: string | null;
  monthlyPriceCents: number;
  monthlyPriceBRL: string;
  isTenantSpecific: boolean;
  appliedRule: "TENANT" | "GLOBAL" | "FALLBACK";
  sourceLabel: string;
}

// Taxas globais padrão (fallback seguro se não houver config no banco)
const SYSTEM_FALLBACK_FEES: Record<PlatformFeeSource, { percentage: number; feePaidBy: FeePaidBy; fixedFee?: number }> = {
  [PlatformFeeSource.TICKET]: { percentage: 5, feePaidBy: FeePaidBy.BUYER },
  [PlatformFeeSource.THEATER]: { percentage: 8, feePaidBy: FeePaidBy.BUYER },
  [PlatformFeeSource.SHOP]: { percentage: 10, feePaidBy: FeePaidBy.SELLER },
  [PlatformFeeSource.DONATION]: { percentage: 3, feePaidBy: FeePaidBy.BUYER },
  [PlatformFeeSource.MEMBERSHIP]: { percentage: 5, feePaidBy: FeePaidBy.SELLER },
  [PlatformFeeSource.SPONSORSHIP_SHARED]: { percentage: 15, feePaidBy: FeePaidBy.BUYER },
  [PlatformFeeSource.SPONSORSHIP_EXCLUSIVE]: { percentage: 20, feePaidBy: FeePaidBy.BUYER },
  [PlatformFeeSource.SERVICE]: { percentage: 10, feePaidBy: FeePaidBy.SELLER },
  [PlatformFeeSource.ACCESSIBILITY]: { percentage: 10, feePaidBy: FeePaidBy.SELLER },
  [PlatformFeeSource.MARKETPLACE]: { percentage: 12, feePaidBy: FeePaidBy.SELLER },
  [PlatformFeeSource.GUIDE]: { percentage: 10, feePaidBy: FeePaidBy.SELLER },
  [PlatformFeeSource.PROVIDER_SUBSCRIPTION]: { percentage: 0, fixedFee: 50, feePaidBy: FeePaidBy.SELLER },
  [PlatformFeeSource.SKIN_PREMIUM]: { percentage: 0, feePaidBy: FeePaidBy.SELLER },
  [PlatformFeeSource.AVATAR_AI]: { percentage: 0, feePaidBy: FeePaidBy.SELLER },
  [PlatformFeeSource.BADGE_PRINTING]: { percentage: 0, feePaidBy: FeePaidBy.SELLER },
  [PlatformFeeSource.BADGE_REISSUE]: { percentage: 0, feePaidBy: FeePaidBy.SELLER },
  [PlatformFeeSource.BADGE_SHIPPING]: { percentage: 0, feePaidBy: FeePaidBy.SELLER },
  [PlatformFeeSource.SKIN_EVENT_EXCLUSIVE]: { percentage: 0, feePaidBy: FeePaidBy.SELLER },
};

// ==========================================
// RESOLUÇÃO DE CONFIG ATIVA
// ==========================================

/**
 * Retorna a config ativa mais prioritária para o par (tenantId, sourceType).
 * Respeita vigência (startsAt / endsAt).
 */
export async function getActiveFeeConfig(tenantId: string | null | undefined, sourceType: PlatformFeeSource) {
  const now = new Date();

  // 1. Tenta config específica do tenant
  if (tenantId) {
    const tenantConfig = await prisma.platformFeeConfig.findFirst({
      where: {
        tenantId,
        sourceType,
        isActive: true,
        OR: [
          { startsAt: null },
          { startsAt: { lte: now } }
        ],
        AND: [
          {
            OR: [
              { endsAt: null },
              { endsAt: { gte: now } }
            ]
          }
        ]
      },
      orderBy: [
        { priority: "desc" },
        { createdAt: "desc" }
      ]
    });

    if (tenantConfig) return { config: tenantConfig, rule: "TENANT" as const };
  }

  // 2. Tenta config global (tenantId null)
  const globalConfig = await prisma.platformFeeConfig.findFirst({
    where: {
      tenantId: null,
      sourceType,
      isActive: true,
      OR: [
        { startsAt: null },
        { startsAt: { lte: now } }
      ],
      AND: [
        {
          OR: [
            { endsAt: null },
            { endsAt: { gte: now } }
          ]
        }
      ]
    },
    orderBy: [
      { priority: "desc" },
      { createdAt: "desc" }
    ]
  });

  if (globalConfig) return { config: globalConfig, rule: "GLOBAL" as const };

  return { config: null, rule: "FALLBACK" as const };
}

// ==========================================
// CÁLCULO PRINCIPAL
// ==========================================

/**
 * Calcula a taxa da plataforma para uma transação.
 * Retorna objeto completo com impacto para comprador e vendedor.
 */
export async function getPlatformFee(input: FeeCalculationInput): Promise<FeeCalculationResult> {
  const { tenantId, sourceType, amountCents } = input;

  const { config, rule } = await getActiveFeeConfig(tenantId, sourceType);

  let percentage: number;
  let fixedFeeCents: number;
  let feePaidBy: FeePaidBy;
  let configId: string | null;

  if (config) {
    percentage = Number(config.percentage);
    fixedFeeCents = config.fixedFee ? Math.round(Number(config.fixedFee) * 100) : 0;
    feePaidBy = config.feePaidBy;
    configId = config.id;
  } else {
    // Fallback hardcoded seguro
    const fallback = SYSTEM_FALLBACK_FEES[sourceType] ?? { percentage: 5, feePaidBy: FeePaidBy.SELLER };
    percentage = fallback.percentage;
    fixedFeeCents = fallback.fixedFee ? Math.round(fallback.fixedFee * 100) : 0;
    feePaidBy = fallback.feePaidBy;
    configId = null;
  }

  const percentageFeeCents = Math.round(amountCents * (percentage / 100));
  const platformFeeCents = percentageFeeCents + fixedFeeCents;

  // Impacto financeiro por modelo
  let buyerPaysCents: number;
  let sellerGrossCents: number;

  if (feePaidBy === FeePaidBy.BUYER) {
    // Comprador paga base + taxa; recebedor recebe o valor base completo
    buyerPaysCents = amountCents + platformFeeCents;
    sellerGrossCents = amountCents;
  } else {
    // Comprador paga base; recebedor recebe base menos a taxa
    buyerPaysCents = amountCents;
    sellerGrossCents = amountCents - platformFeeCents;
  }

  if (sellerGrossCents < 0) {
    throw new Error("A taxa da plataforma nao pode ser maior que o valor base quando paga pelo recebedor.");
  }

  return {
    configId,
    sourceType,
    percentage,
    fixedFeeCents,
    platformFeeCents,
    feePaidBy,
    baseAmountCents: amountCents,
    buyerPaysCents,
    sellerGrossCents,
    isTenantSpecific: rule === "TENANT",
    appliedRule: rule
  };
}

// ==========================================
// VALIDAÇÃO DE SOBREPOSIÇÃO
// ==========================================

/**
 * Verifica se existe sobreposição temporal de configs ativas para
 * o mesmo par (tenantId, sourceType).
 * Retorna a config conflitante, ou null se não houver.
 */
export async function getProviderSubscriptionPricing(
  tenantId: string | null | undefined
): Promise<ProviderSubscriptionPricing> {
  const { config, rule } = await getActiveFeeConfig(tenantId, PlatformFeeSource.PROVIDER_SUBSCRIPTION);
  const fallback = SYSTEM_FALLBACK_FEES[PlatformFeeSource.PROVIDER_SUBSCRIPTION];
  const fixedFee = config?.fixedFee !== null && config?.fixedFee !== undefined
    ? Number(config.fixedFee)
    : fallback.fixedFee ?? 50;
  const monthlyPriceCents = Math.max(0, Math.round(fixedFee * 100));

  return {
    configId: config?.id ?? null,
    monthlyPriceCents,
    monthlyPriceBRL: (monthlyPriceCents / 100).toFixed(2),
    isTenantSpecific: rule === "TENANT",
    appliedRule: rule,
    sourceLabel: FEE_SOURCE_LABELS[PlatformFeeSource.PROVIDER_SUBSCRIPTION]
  };
}

export async function validateNoOverlap(params: {
  tenantId: string | null;
  sourceType: PlatformFeeSource;
  startsAt: Date | null;
  endsAt: Date | null;
  excludeId?: string;
}) {
  const { tenantId, sourceType, startsAt, endsAt, excludeId } = params;

  // Busca configs ativas para o mesmo tenant + source
  const existing = await prisma.platformFeeConfig.findMany({
    where: {
      tenantId: tenantId ?? null,
      sourceType,
      isActive: true,
      id: excludeId ? { not: excludeId } : undefined
    }
  });

  // Checa sobreposição de vigência
  const newStart = startsAt ?? new Date(0);
  const newEnd = endsAt ?? new Date("9999-12-31");

  for (const cfg of existing) {
    const cfgStart = cfg.startsAt ?? new Date(0);
    const cfgEnd = cfg.endsAt ?? new Date("9999-12-31");

    const overlaps = newStart < cfgEnd && newEnd > cfgStart;
    if (overlaps) return cfg; // conflitante encontrado
  }

  return null; // sem conflito
}

// ==========================================
// SEED IDEMPOTENTE DE TAXAS PADRÃO
// ==========================================

const DEFAULT_GLOBAL_FEES: {
  sourceType: PlatformFeeSource;
  name: string;
  percentage: number;
  fixedFee?: number;
  feePaidBy: FeePaidBy;
  notes?: string;
}[] = [
  { sourceType: PlatformFeeSource.TICKET, name: "Taxa padrão — Bilheteria", percentage: 5, feePaidBy: FeePaidBy.BUYER },
  { sourceType: PlatformFeeSource.THEATER, name: "Taxa padrão — Teatro", percentage: 8, feePaidBy: FeePaidBy.BUYER },
  { sourceType: PlatformFeeSource.SHOP, name: "Taxa padrão — Loja", percentage: 10, feePaidBy: FeePaidBy.SELLER },
  { sourceType: PlatformFeeSource.DONATION, name: "Taxa padrão — Doações", percentage: 3, feePaidBy: FeePaidBy.BUYER },
  { sourceType: PlatformFeeSource.MEMBERSHIP, name: "Taxa padrão — Clube/Membership", percentage: 5, feePaidBy: FeePaidBy.SELLER },
  { sourceType: PlatformFeeSource.SPONSORSHIP_SHARED, name: "Taxa padrão — Patrocínio Compartilhado", percentage: 15, feePaidBy: FeePaidBy.BUYER },
  { sourceType: PlatformFeeSource.SPONSORSHIP_EXCLUSIVE, name: "Taxa padrão — Patrocínio Exclusivo", percentage: 20, feePaidBy: FeePaidBy.BUYER },
  { sourceType: PlatformFeeSource.SERVICE, name: "Taxa padrão — Serviços/Prestadores", percentage: 10, feePaidBy: FeePaidBy.SELLER },
  { sourceType: PlatformFeeSource.ACCESSIBILITY, name: "Taxa padrão — Acessibilidade", percentage: 10, feePaidBy: FeePaidBy.SELLER },
  { sourceType: PlatformFeeSource.MARKETPLACE, name: "Taxa padrão — Marketplace", percentage: 12, feePaidBy: FeePaidBy.SELLER },
  { sourceType: PlatformFeeSource.GUIDE, name: "Taxa padrão — Guias Turísticos", percentage: 10, feePaidBy: FeePaidBy.SELLER },
  {
    sourceType: PlatformFeeSource.PROVIDER_SUBSCRIPTION,
    name: "Mensalidade padrao - Prestador habilitado para propostas",
    percentage: 0,
    fixedFee: 50,
    feePaidBy: FeePaidBy.SELLER,
    notes: "Cadastro gratuito. A mensalidade habilita o prestador a responder conversas, enviar propostas e solicitar pagamentos em projetos aprovados."
  },
];

/**
 * Seed idempotente das taxas globais padrão.
 * Só cria se NÃO existir uma config global ativa para aquele sourceType.
 * NÃO sobrescreve configs já existentes.
 *
 * @param createdById ID do usuário Master que disparou o seed
 */
export async function seedDefaultFees(createdById: string): Promise<{
  created: number;
  skipped: number;
  details: string[];
}> {
  let created = 0;
  let skipped = 0;
  const details: string[] = [];

  for (const fee of DEFAULT_GLOBAL_FEES) {
    // Verifica se já existe config global ativa para esse sourceType
    const existing = await prisma.platformFeeConfig.findFirst({
      where: {
        tenantId: null,
        sourceType: fee.sourceType,
        isActive: true
      }
    });

    if (existing) {
      skipped++;
      details.push(`SKIPPED: ${fee.sourceType} — já existe config global ativa (${Number(existing.percentage)}%)`);
      continue;
    }

    await prisma.platformFeeConfig.create({
      data: {
        tenantId: null,
        sourceType: fee.sourceType,
        name: fee.name,
        percentage: fee.percentage,
        fixedFee: fee.fixedFee ?? null,
        feePaidBy: fee.feePaidBy,
        isActive: true,
        priority: 0,
        notes: "Seed automático de taxas padrão globais da plataforma.",
        createdById
      }
    });

    created++;
    details.push(`CREATED: ${fee.sourceType} — ${fee.percentage}% (${fee.feePaidBy})`);
  }

  return { created, skipped, details };
}

// ==========================================
// LABELS PARA O FRONTEND
// ==========================================

export const FEE_SOURCE_LABELS: Record<PlatformFeeSource, string> = {
  [PlatformFeeSource.TICKET]: "Bilheteria / Ingressos",
  [PlatformFeeSource.THEATER]: "Teatro",
  [PlatformFeeSource.SHOP]: "Loja",
  [PlatformFeeSource.DONATION]: "Doações",
  [PlatformFeeSource.MEMBERSHIP]: "Clube / Membership",
  [PlatformFeeSource.SPONSORSHIP_SHARED]: "Patrocínio Compartilhado",
  [PlatformFeeSource.SPONSORSHIP_EXCLUSIVE]: "Patrocínio Exclusivo",
  [PlatformFeeSource.SERVICE]: "Serviços / Prestadores",
  [PlatformFeeSource.ACCESSIBILITY]: "Acessibilidade",
  [PlatformFeeSource.MARKETPLACE]: "Marketplace",
  [PlatformFeeSource.GUIDE]: "Guias Turísticos",
  [PlatformFeeSource.PROVIDER_SUBSCRIPTION]: "Assinatura de Prestador",
  [PlatformFeeSource.SKIN_PREMIUM]: "Skins Premium",
  [PlatformFeeSource.AVATAR_AI]: "Geração Avatar IA",
  [PlatformFeeSource.BADGE_PRINTING]: "Impressão de Crachá",
  [PlatformFeeSource.BADGE_REISSUE]: "Reemissão de Crachá",
  [PlatformFeeSource.BADGE_SHIPPING]: "Envio de Crachá",
  [PlatformFeeSource.SKIN_EVENT_EXCLUSIVE]: "Skin Evento Exclusivo",
};
