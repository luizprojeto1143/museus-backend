import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role, SponsorshipContractStatus, SponsorshipTargetType } from "@prisma/client";
import { stripe } from "../services/stripeService.js";
import { syncLedgerEntry } from "../services/ledgerService.js";

const router = Router();
export const municipalSponsorRouter = Router();

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

// GET /sponsor-portal/my-sponsorships
router.get("/my-sponsorships", authMiddleware, async (req: Request, res: Response) => {
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

    const asset = await prisma.sponsorshipAsset.update({
      where: { id: assetId },
      data: {
        status,
        rejectionReason,
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
