import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import {
  Role,
  SponsorshipAssetStatus,
  SponsorshipAssetType,
  SponsorshipContractStatus,
  SponsorshipTargetType,
  SponsorshipStatus,
  SponsorshipTier
} from "@prisma/client";
import { stripe } from "../services/stripeService.js";
import { syncLedgerEntry } from "../services/ledgerService.js";

const router = Router();
export const municipalSponsorRouter = Router();
const MAX_SHARED_SPONSORS_PER_WORK = 10;
const RESERVED_SPONSORSHIP_STATUSES = [SponsorshipStatus.PENDING, SponsorshipStatus.ACTIVE];

// ==========================================
// 1. PUBLIC ENDPOINTS
// ==========================================

// GET /sponsor-portal/opportunities
// Retorna oportunidades de patrocínio disponíveis
router.get("/opportunities", async (req, res) => {
  try {
    const opportunities = await prisma.sponsorshipOpportunity.findMany({
      where: { isActive: true }
    });
    return res.json(opportunities);
  } catch (error) {
    console.error("Erro ao listar oportunidades:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

router.get("/works", async (req, res) => {
  try {
    const works = await prisma.work.findMany({
      where: { published: true, deletedAt: null },
      take: Math.min(Number(req.query.limit) || 60, 100),
      orderBy: { createdAt: "desc" },
      include: {
        tenant: { select: { name: true, slug: true } },
        workSponsorships: {
          where: { status: { in: RESERVED_SPONSORSHIP_STATUSES } },
          select: { id: true, tier: true }
        }
      }
    });

    return res.json(works.map(work => {
      const activeSponsors = work.workSponsorships.filter(s => s.tier === SponsorshipTier.EXCLUSIVE || s.tier === SponsorshipTier.SHARED);
      const hasExclusiveSponsor = activeSponsors.some(s => s.tier === SponsorshipTier.EXCLUSIVE);
      const sharedSponsorsCount = activeSponsors.filter(s => s.tier === SponsorshipTier.SHARED).length;
      return {
        id: work.id,
        title: work.title,
        imageUrl: work.imageUrl,
        tenantName: work.tenant.name,
        tenantSlug: work.tenant.slug,
        hasExclusiveSponsor,
        sharedSponsorsCount,
        maxSharedSponsors: MAX_SHARED_SPONSORS_PER_WORK,
        sharedSlotsAvailable: Math.max(0, MAX_SHARED_SPONSORS_PER_WORK - sharedSponsorsCount),
        canSponsorShared: !hasExclusiveSponsor && sharedSponsorsCount < MAX_SHARED_SPONSORS_PER_WORK,
        canSponsorExclusive: activeSponsors.length === 0
      };
    }));
  } catch (error) {
    console.error("Erro ao listar obras patrocinaveis:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

router.get("/works/:workId/sponsorships", async (req, res) => {
  try {
    const directSponsorships = await prisma.workSponsorship.findMany({
      where: {
        workId: req.params.workId,
        active: true,
        status: SponsorshipStatus.ACTIVE
      },
      select: {
        id: true,
        sponsorName: true,
        sponsorLogo: true,
        sponsorUrl: true,
        message: true,
        tier: true,
        startDate: true
      },
      orderBy: [{ tier: "asc" }, { startDate: "desc" }]
    });

    const contractAssets = await prisma.sponsorshipAsset.findMany({
      where: {
        type: SponsorshipAssetType.LOGO,
        status: SponsorshipAssetStatus.APPROVED,
        contract: {
          status: SponsorshipContractStatus.ACTIVE,
          opportunity: {
            targetType: SponsorshipTargetType.WORK,
            targetId: req.params.workId,
            isActive: true
          }
        }
      },
      include: {
        contract: {
          select: {
            id: true,
            sponsorName: true,
            sponsorWebsite: true,
            startDate: true,
            opportunity: { select: { tenantId: true } }
          }
        }
      },
      orderBy: { updatedAt: "desc" }
    });

    const sponsorships = [
      ...directSponsorships.map(sponsorship => ({ ...sponsorship, source: "WORK_SPONSORSHIP" })),
      ...contractAssets.map(asset => ({
        id: `asset-${asset.id}`,
        sponsorName: asset.contract.sponsorName,
        sponsorLogo: asset.url,
        sponsorUrl: asset.contract.sponsorWebsite,
        message: null,
        tier: SponsorshipTier.SHARED,
        startDate: asset.contract.startDate || asset.createdAt,
        source: "SPONSORSHIP_CONTRACT",
        contractId: asset.contract.id
      }))
    ];

    return res.json(sponsorships);
  } catch (error) {
    return res.status(500).json({ error: "Erro ao carregar patrocinadores da obra." });
  }
});

router.get("/pricing", async (req, res) => {
  try {
    let availability = null;
    if (req.query.workId) {
      const work = await prisma.work.findUnique({ where: { id: String(req.query.workId) }, select: { id: true } });
      if (!work) return res.status(404).json({ error: "Obra nao encontrada." });

      const reserved = await prisma.workSponsorship.findMany({
        where: {
          workId: work.id,
          status: { in: RESERVED_SPONSORSHIP_STATUSES }
        },
        select: { tier: true }
      });
      const hasExclusiveSponsor = reserved.some(s => s.tier === SponsorshipTier.EXCLUSIVE);
      const sharedSponsorsCount = reserved.filter(s => s.tier === SponsorshipTier.SHARED).length;
      availability = {
        hasExclusiveSponsor,
        sharedSponsorsCount,
        maxSharedSponsors: MAX_SHARED_SPONSORS_PER_WORK,
        sharedSlotsAvailable: Math.max(0, MAX_SHARED_SPONSORS_PER_WORK - sharedSponsorsCount),
        canSponsorShared: !hasExclusiveSponsor && sharedSponsorsCount < MAX_SHARED_SPONSORS_PER_WORK,
        canSponsorExclusive: reserved.length === 0
      };
    }

    return res.json({
      exclusivePrice: Number(process.env.SPONSOR_EXCLUSIVE_PRICE_BRL || 500),
      sharedPrice: Number(process.env.SPONSOR_SHARED_PRICE_BRL || 250),
      maxSharedSponsors: MAX_SHARED_SPONSORS_PER_WORK,
      availability
    });
  } catch (error) {
    return res.status(500).json({ error: "Erro ao carregar precos." });
  }
});

router.post("/subscribe", authMiddleware, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = req.user!;
    const { workId, sponsorName, sponsorEmail, sponsorCNPJ, sponsorLogo, sponsorUrl, tier } = req.body;

    if (!workId || !sponsorName || !sponsorEmail || !sponsorCNPJ) {
      return res.status(400).json({ error: "Dados obrigatorios ausentes." });
    }

    const selectedTier = tier === SponsorshipTier.EXCLUSIVE ? SponsorshipTier.EXCLUSIVE : SponsorshipTier.SHARED;
    const monthlyAmount = selectedTier === SponsorshipTier.EXCLUSIVE
      ? Number(process.env.SPONSOR_EXCLUSIVE_PRICE_BRL || 500)
      : Number(process.env.SPONSOR_SHARED_PRICE_BRL || 250);

    const { sponsorship, work } = await prisma.$transaction(async (tx) => {
      const lockedWorks = await tx.$queryRaw<Array<{ id: string; title: string; tenantId: string }>>`
        SELECT id, title, "tenantId" FROM "Work" WHERE id = ${workId} FOR UPDATE
      `;
      const lockedWork = lockedWorks[0];
      if (!lockedWork) throw new Error("WORK_NOT_FOUND");

      const reserved = await tx.workSponsorship.findMany({
        where: {
          workId,
          status: { in: RESERVED_SPONSORSHIP_STATUSES }
        },
        select: { id: true, tier: true, sponsorUserId: true, sponsorEmail: true }
      });

      const hasExclusiveSponsor = reserved.some(s => s.tier === SponsorshipTier.EXCLUSIVE);
      const sharedSponsorsCount = reserved.filter(s => s.tier === SponsorshipTier.SHARED).length;
      const sameSponsorAlreadyReserved = reserved.some(s =>
        s.sponsorUserId === user.id || s.sponsorEmail?.toLowerCase() === String(sponsorEmail).toLowerCase()
      );

      if (sameSponsorAlreadyReserved) {
        throw new Error("DUPLICATE_SPONSOR");
      }

      if (selectedTier === SponsorshipTier.EXCLUSIVE && reserved.length > 0) {
        throw new Error("EXCLUSIVE_REQUIRES_EMPTY_WORK");
      }

      if (selectedTier === SponsorshipTier.SHARED && hasExclusiveSponsor) {
        throw new Error("WORK_HAS_EXCLUSIVE_SPONSOR");
      }

      if (selectedTier === SponsorshipTier.SHARED && sharedSponsorsCount >= MAX_SHARED_SPONSORS_PER_WORK) {
        throw new Error("SHARED_LIMIT_REACHED");
      }

      const created = await tx.workSponsorship.create({
        data: {
          workId,
          tenantId: lockedWork.tenantId,
          sponsorUserId: user.id,
          sponsorName,
          sponsorEmail,
          sponsorCNPJ,
          sponsorLogo: sponsorLogo || null,
          sponsorUrl: sponsorUrl || null,
          tier: selectedTier,
          monthlyAmount,
          status: SponsorshipStatus.PENDING,
          active: false
        }
      });

      return { sponsorship: created, work: lockedWork };
    });

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.json({ checkoutUrl: `${frontendUrl}/sponsor/dashboard?pending=${sponsorship.id}` });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "brl",
          recurring: { interval: "month" },
          product_data: { name: `Patrocinio ${selectedTier}: ${work.title}` },
          unit_amount: Math.round(monthlyAmount * 100)
        },
        quantity: 1
      }],
      success_url: `${frontendUrl}/sponsor/dashboard?success=true`,
      cancel_url: `${frontendUrl}/patrocinar/checkout/${workId}?cancel=true`,
      metadata: { workSponsorshipId: sponsorship.id }
    });

    return res.json({ checkoutUrl: session.url });
  } catch (error: any) {
    console.error("Erro ao assinar patrocinio:", error);
    if (error?.message === "WORK_NOT_FOUND") return res.status(404).json({ error: "Obra nao encontrada." });
    if (error?.message === "DUPLICATE_SPONSOR") return res.status(409).json({ error: "Este patrocinador ja possui uma cota ativa ou pendente nesta obra." });
    if (error?.message === "EXCLUSIVE_REQUIRES_EMPTY_WORK") return res.status(409).json({ error: "Patrocinio exclusivo exige que a obra nao tenha cotas ativas ou pendentes." });
    if (error?.message === "WORK_HAS_EXCLUSIVE_SPONSOR") return res.status(409).json({ error: "Esta obra ja possui patrocinio exclusivo ativo ou pendente." });
    if (error?.message === "SHARED_LIMIT_REACHED") return res.status(409).json({ error: `Esta obra ja atingiu o limite de ${MAX_SHARED_SPONSORS_PER_WORK} patrocinadores compartilhados.` });
    return res.status(500).json({ error: error.message || "Erro ao gerar checkout." });
  }
});

// ==========================================
// 2. SPONSOR ENDPOINTS
// ==========================================

// POST /sponsor-portal/opportunities/:id/apply
// Aplica para cota de patrocínio com validação de limite transacional (ACTIVE + PAYMENT_PENDING)
router.post("/opportunities/:opportunityId/apply", authMiddleware, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = req.user!;
    const { opportunityId } = req.params;
    const { sponsorName, sponsorCNPJ, sponsorEmail, sponsorWebsite } = req.body;

    if (!sponsorName || !sponsorCNPJ || !sponsorEmail) {
      return res.status(400).json({ error: "Dados obrigatórios ausentes (nome, CNPJ ou email)." });
    }

    // Transação estrita para validar quotaLimit
    const result = await prisma.$transaction(async (tx) => {
      const opp = await tx.sponsorshipOpportunity.findUnique({
        where: { id: opportunityId }
      });

      if (!opp) {
        throw new Error("Oportunidade não encontrada");
      }

      if (!opp.isActive) {
        throw new Error("Oportunidade inativa");
      }

      // Contar contratos ativos e pendentes de pagamento
      const count = await tx.sponsorshipContract.count({
        where: {
          opportunityId,
          status: {
            in: [SponsorshipContractStatus.ACTIVE, SponsorshipContractStatus.PAYMENT_PENDING]
          }
        }
      });

      if (count >= opp.quotaLimit) {
        throw new Error("Limite de cotas atingido para esta oportunidade.");
      }

      // Criar contrato PENDING
      const contract = await tx.sponsorshipContract.create({
        data: {
          sponsorUserId: user.id,
          opportunityId,
          sponsorName,
          sponsorCNPJ,
          sponsorEmail,
          sponsorWebsite,
          status: SponsorshipContractStatus.PAYMENT_PENDING
        }
      });

      return { contract, opp };
    });

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    // Criar Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'pix'],
      line_items: [
        {
          price_data: {
            currency: 'brl',
            product_data: {
              name: `Patrocínio: ${result.opp.title}`,
              description: result.opp.description
            },
            unit_amount: Number(result.opp.price) * 100 // em centavos
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: `${frontendUrl}/patrocinar/sucesso?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/sponsor/opportunities`,
      metadata: {
        sponsorshipContractId: result.contract.id,
        opportunityId: result.opp.id
      }
    });

    // Atualiza contrato com stripe session ID
    await prisma.sponsorshipContract.update({
      where: { id: result.contract.id },
      data: { stripeCheckoutSessionId: session.id }
    });

    return res.json({ checkoutUrl: session.url });
  } catch (error: any) {
    console.error("Erro ao aplicar para oportunidade:", error);
    return res.status(400).json({ error: error.message || "Erro ao processar." });
  }
});

router.get("/my-work-sponsorships", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const sponsorships = await prisma.workSponsorship.findMany({
      where: {
        OR: [
          { sponsorUserId: user.id },
          { sponsorEmail: user.email }
        ]
      },
      include: { work: { select: { id: true, title: true, imageUrl: true } } },
      orderBy: { createdAt: "desc" }
    });
    return res.json(sponsorships);
  } catch (error) {
    return res.status(500).json({ error: "Erro interno." });
  }
});

// Backward-compatible alias for the direct work sponsorship dashboard.
router.get("/my-sponsorships", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const sponsorships = await prisma.workSponsorship.findMany({
      where: {
        OR: [
          { sponsorUserId: user.id },
          { sponsorEmail: user.email }
        ]
      },
      include: { work: { select: { id: true, title: true, imageUrl: true } } },
      orderBy: { createdAt: "desc" }
    });
    return res.json(sponsorships);
  } catch (error) {
    return res.status(500).json({ error: "Erro interno." });
  }
});

router.delete("/:id/cancel", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const sponsorship = await prisma.workSponsorship.findFirst({
      where: {
        id: req.params.id,
        OR: [{ sponsorUserId: user.id }, { sponsorEmail: user.email }]
      }
    });

    if (!sponsorship) return res.status(404).json({ error: "Patrocinio nao encontrado." });

    const updated = await prisma.workSponsorship.update({
      where: { id: req.params.id },
      data: {
        status: SponsorshipStatus.CANCELLED,
        active: false,
        endDate: new Date()
      }
    });

    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: "Erro ao cancelar patrocinio." });
  }
});

// GET /sponsor-portal/my-contracts
router.get("/my-contracts", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const contracts = await prisma.sponsorshipContract.findMany({
      where: {
        OR: [
          { sponsorUserId: user.id },
          { sponsorEmail: user.email }
        ]
      },
      include: { opportunity: true }
    });
    return res.json(contracts);
  } catch (error) {
    console.error("Erro ao carregar meus patrocínios:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

// GET /sponsor-portal/contracts/:contractId/assets
router.get("/contracts/:contractId/assets", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { contractId } = req.params;
    const assets = await prisma.sponsorshipAsset.findMany({
      where: { contractId }
    });
    return res.json(assets);
  } catch (error) {
    return res.status(500).json({ error: "Erro ao carregar ativos." });
  }
});

// POST /sponsor-portal/contracts/:contractId/assets
router.post("/contracts/:contractId/assets", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { contractId } = req.params;
    const { type, url } = req.body;

    const asset = await prisma.sponsorshipAsset.create({
      data: {
        contractId,
        type,
        url,
        status: "PENDING"
      }
    });
    return res.json(asset);
  } catch (error) {
    return res.status(500).json({ error: "Erro ao enviar ativo." });
  }
});

// GET /sponsor-portal/certificates
router.get("/certificates", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const certificates = await prisma.sponsorCertificate.findMany({
      where: {
        contract: {
          OR: [
            { sponsorUserId: user.id },
            { sponsorEmail: user.email }
          ]
        }
      },
      include: {
        contract: {
          include: { opportunity: true }
        }
      }
    });
    return res.json(certificates);
  } catch (error) {
    return res.status(500).json({ error: "Erro ao buscar certificados." });
  }
});

// GET /sponsor-portal/dashboard
// Retorna métricas consolidadas do patrocinador de SponsorshipImpactEvent
router.get("/dashboard", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    
    const contracts = await prisma.sponsorshipContract.findMany({
      where: {
        OR: [
          { sponsorUserId: user.id },
          { sponsorEmail: user.email }
        ],
        status: SponsorshipContractStatus.ACTIVE
      },
      include: {
        opportunity: true
      }
    });

    const contractIds = contracts.map(c => c.id);

    const events = await prisma.sponsorshipImpactEvent.findMany({
      where: {
        contractId: { in: contractIds }
      }
    });

    const views = events.filter(e => e.type === "VIEW").length;
    const clicks = events.filter(e => e.type === "CLICK").length;
    const qrScans = events.filter(e => e.type === "QR_SCAN").length;
    const visits = events.filter(e => e.type === "EVENT_VISIT").length;
    const accessibilityDeliveries = events.filter(e => e.type === "ACCESSIBILITY_DELIVERY").length;

    const totalInvestment = contracts.reduce((acc, c) => acc + Number(c.opportunity.price), 0);

    return res.json({
      views,
      clicks,
      qrScans,
      visits,
      accessibilityDeliveries,
      totalInvestment
    });
  } catch (error) {
    return res.status(500).json({ error: "Erro no dashboard de impacto." });
  }
});

// ==========================================
// 3. ADMIN & MUNICIPAL ENDPOINTS
// ==========================================

// GET /sponsor-portal/admin/list
router.get("/admin/list", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const contracts = await prisma.sponsorshipContract.findMany({
      where: user.role === Role.MASTER ? {} : { opportunity: { tenantId: user.tenantId as string } },
      include: { 
        opportunity: true,
        assets: true
      }
    });
    return res.json(contracts);
  } catch (error) {
    return res.status(500).json({ error: "Erro ao listar contratos admin." });
  }
});

// POST /sponsor-portal/contracts/:contractId/issue-certificate
router.post("/contracts/:contractId/issue-certificate", authMiddleware, async (req: Request, res: Response): Promise<any> => {
  try {
    const { contractId } = req.params;
    const { title, description } = req.body;

    const contract = await prisma.sponsorshipContract.findUnique({
      where: { id: contractId }
    });

    if (!contract) {
      return res.status(404).json({ error: "Contrato não encontrado." });
    }

    const cert = await prisma.sponsorCertificate.create({
      data: {
        contractId,
        sponsorUserId: contract.sponsorUserId,
        certificateNumber: `CERT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        certificateUrl: `/certificates/print/${contractId}`,
        title,
        description
      }
    });

    return res.json(cert);
  } catch (error) {
    return res.status(500).json({ error: "Erro ao emitir certificado." });
  }
});

// ==========================================
// 4. MUNICIPAL ROUTER MOUNTED ON /municipal
// ==========================================

// POST /municipal/sponsorship-opportunities
municipalSponsorRouter.post("/sponsorship-opportunities", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { title, description, targetType, price, quotaLimit } = req.body;

    const opp = await prisma.sponsorshipOpportunity.create({
      data: {
        tenantId: user.tenantId || "municipal-tenant",
        title,
        description,
        targetType,
        price,
        quotaLimit,
        isActive: true
      }
    });

    return res.json(opp);
  } catch (error) {
    return res.status(500).json({ error: "Erro ao criar oportunidade municipal." });
  }
});

// POST /municipal/sponsorship-assets/:assetId/review
municipalSponsorRouter.post("/sponsorship-assets/:assetId/review", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { assetId } = req.params;
    const { status, rejectionReason } = req.body;
    const nextStatus = status as SponsorshipAssetStatus;

    if (![SponsorshipAssetStatus.APPROVED, SponsorshipAssetStatus.REJECTED, SponsorshipAssetStatus.PENDING].includes(nextStatus)) {
      return res.status(400).json({ error: "Status de asset invalido." });
    }

    if (nextStatus === SponsorshipAssetStatus.REJECTED && !rejectionReason) {
      return res.status(400).json({ error: "Informe o motivo da rejeicao." });
    }

    const asset = await prisma.sponsorshipAsset.update({
      where: { id: assetId },
      data: {
        status: nextStatus,
        rejectionReason: nextStatus === SponsorshipAssetStatus.REJECTED ? rejectionReason : null,
        reviewedByUserId: user.id,
        reviewedAt: new Date()
      }
    });

    return res.json(asset);
  } catch (error) {
    return res.status(500).json({ error: "Erro ao revisar ativo." });
  }
});

export default router;
