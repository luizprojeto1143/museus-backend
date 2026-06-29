import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, softAuthMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { stripe } from "../services/stripeService.js";
import { syncLedgerEntry } from "../services/ledgerService.js";

const router = Router();

// GET /sponsor-portal/works
// Público: Lista obras disponíveis para patrocínio
router.get("/works", async (req, res) => {
  try {
    const works = await prisma.work.findMany({
      where: { published: true },
      select: {
        id: true,
        title: true,
        artist: true,
        imageUrl: true,
        tenant: {
          select: { name: true }
        },
        workSponsorships: {
          where: { status: 'ACTIVE' },
          select: { tier: true }
        }
      }
    });

    const worksWithSponsorData = works.map(work => {
      const activeSponsors = work.workSponsorships;
      const hasExclusiveSponsor = activeSponsors.some((s: any) => s.tier === 'EXCLUSIVE');
      return {
        id: work.id,
        title: work.title,
        artist: work.artist,
        imageUrl: work.imageUrl,
        tenantName: work.tenant.name,
        hasExclusiveSponsor,
        activeSponsorCount: activeSponsors.length
      };
    });

    return res.json(worksWithSponsorData);
  } catch (error) {
    console.error("Erro ao listar obras para patrocínio:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

// GET /sponsor-portal/works/:workId/sponsorships
// Público: Retorna patrocinadores ACTIVE desta obra
router.get("/works/:workId/sponsorships", async (req, res) => {
  try {
    const { workId } = req.params;
    const sponsorships = await prisma.workSponsorship.findMany({
      where: {
        workId,
        status: 'ACTIVE'
      },
      select: {
        id: true,
        tier: true,
        sponsorName: true,
        sponsorLogo: true,
        sponsorUrl: true,
        message: true
      }
    });
    return res.json(sponsorships);
  } catch (error) {
    console.error("Erro ao listar patrocinadores da obra:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

// GET /sponsor-portal/pricing
// Público: Retorna os preços configurados
router.get("/pricing", async (req, res) => {
  try {
    const { workId } = req.query;
    if (!workId) {
      return res.json({ exclusivePrice: 500.00, sharedPrice: 250.00 });
    }
    const work = await prisma.work.findUnique({
      where: { id: String(workId) },
      include: { tenant: true }
    });
    if (!work) return res.status(404).json({ error: "Obra não encontrada" });

    return res.json({
      exclusivePrice: work.tenant.sponsorExclusivePrice ?? 500.00,
      sharedPrice: work.tenant.sponsorSharedPrice ?? 250.00
    });
  } catch (error) {
    return res.status(500).json({ error: "Erro interno" });
  }
});

// POST /sponsor-portal/subscribe
// Cria assinatura de patrocínio via Stripe
router.post("/subscribe", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { workId, tier, sponsorName, sponsorCNPJ, sponsorEmail, sponsorLogo, sponsorUrl, message } = req.body;

    if (!workId || !tier || !sponsorName || !sponsorEmail) {
      return res.status(400).json({ error: "Dados incompletos" });
    }

    const work = await prisma.work.findUnique({
      where: { id: workId },
      include: { tenant: true }
    });

    if (!work) {
      return res.status(404).json({ error: "Obra não encontrada" });
    }

    // Verifica exclusividade
    if (tier === 'EXCLUSIVE') {
      const existingExclusive = await prisma.workSponsorship.findFirst({
        where: { workId, tier: 'EXCLUSIVE', status: 'ACTIVE' }
      });
      if (existingExclusive) {
        return res.status(409).json({ error: "Esta obra já possui um patrocinador exclusivo ativo." });
      }
    }

    const exclusivePrice = work.tenant.sponsorExclusivePrice ?? 500.00;
    const sharedPrice = work.tenant.sponsorSharedPrice ?? 250.00;
    const amount = tier === 'EXCLUSIVE' ? exclusivePrice : sharedPrice;
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    // Cria registro no banco como PENDING
    const sponsorship = await prisma.workSponsorship.create({
      data: {
        tier,
        status: 'PENDING',
        monthlyAmount: amount,
        platformFeePercent: tier === 'EXCLUSIVE' ? 20 : 15,
        sponsorName,
        sponsorCNPJ,
        sponsorEmail,
        sponsorLogo,
        sponsorUrl,
        message,
        workId,
        tenantId: work.tenantId,
        sponsorUserId: user.id
      }
    });

    // Cria sessão no Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'pix'],
      line_items: [
        {
          price_data: {
            currency: 'brl',
            product_data: {
              name: `Patrocínio de Obra: ${work.title} (${tier})`,
            },
            unit_amount: amount * 100, // em centavos
            recurring: { interval: 'month' }
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${frontendUrl}/patrocinar/sucesso?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/patrocinar/obras/${workId}`,
      metadata: {
        sponsorshipId: sponsorship.id,
        workId: work.id,
        tenantId: work.tenantId
      }
    });

    return res.json({ checkoutUrl: session.url });
  } catch (error) {
    console.error("Erro ao criar assinatura de patrocínio:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

// GET /sponsor-portal/my-sponsorships
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
      include: { work: true }
    });
    return res.json(sponsorships);
  } catch (error) {
    console.error("Erro ao listar meus patrocínios:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

// DELETE /sponsor-portal/:id/cancel
router.delete("/:id/cancel", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const sponsorship = await prisma.workSponsorship.findUnique({ where: { id } });
    if (!sponsorship) {
      return res.status(404).json({ error: "Patrocínio não encontrado." });
    }

    if (sponsorship.sponsorUserId !== user.id && sponsorship.sponsorEmail !== user.email && user.role !== Role.MASTER) {
      return res.status(403).json({ error: "Acesso negado." });
    }

    if (sponsorship.stripeSubscriptionId) {
      await stripe.subscriptions.cancel(sponsorship.stripeSubscriptionId);
    }

    await prisma.workSponsorship.update({
      where: { id },
      data: { status: 'CANCELLED', active: false, endDate: new Date() }
    });

    return res.json({ message: "Assinatura cancelada com sucesso." });
  } catch (error) {
    console.error("Erro ao cancelar patrocínio:", error);
    return res.status(500).json({ error: "Erro ao cancelar." });
  }
});

// GET /sponsor-portal/admin/list
router.get("/admin/list", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const sponsorships = await prisma.workSponsorship.findMany({
      where: user.role === Role.MASTER ? {} : { tenantId: user.tenantId as string },
      include: { work: { select: { title: true } } }
    });
    return res.json(sponsorships);
  } catch (error) {
    console.error("Erro ao listar patrocínios admin:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
});

// POST /sponsor-portal/webhook
router.post("/webhook", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_SPONSOR_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig as string,
      endpointSecret as string
    );
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const result = await handleSponsorWebhookEvent(event);

    if (result.duplicate) {
      console.log(`[Stripe Sponsor Webhook] Event ${event.id} already processed. Skipping.`);
      return res.status(200).send({ received: true, duplicate: true });
    }

  } catch (error) {
    console.error("Erro processando webhook sponsor-portal:", error);
    
    try {
      await prisma.stripeWebhookEvent.upsert({
        where: { id: event.id },
        update: { status: "FAILED" },
        create: { id: event.id, type: event.type, status: "FAILED" }
      });
    } catch (dbErr) {
      console.error("Erro ao salvar status de falha do webhook no banco:", dbErr);
    }
    
    return res.status(500).send("Internal Server Error");
  }

  return res.status(200).send({ received: true });
});

// Helper for executing sponsor webhook processing
export async function handleSponsorWebhookEvent(event: any) {
  const result = await prisma.$transaction(async (tx) => {
    // 1. Check idempotency
    const existingEvent = await tx.stripeWebhookEvent.findUnique({
      where: { id: event.id }
    });
    if (existingEvent && (existingEvent.status === "PROCESSED" || existingEvent.status === "PROCESSING")) {
      if (existingEvent.status === "PROCESSING") {
        const isStale = Date.now() - new Date(existingEvent.updatedAt).getTime() > 15 * 60 * 1000;
        if (isStale) {
          console.log(`[Stripe Sponsor Webhook] Event ${event.id} is PROCESSING but stale (updatedAt: ${existingEvent.updatedAt.toISOString()}). Reprocessing...`);
        } else {
          return { duplicate: true, pendingTransfer: null };
        }
      } else {
        return { duplicate: true, pendingTransfer: null };
      }
    }

    // 2. Mark as PROCESSING
    await tx.stripeWebhookEvent.upsert({
      where: { id: event.id },
      update: { status: "PROCESSING" },
      create: { id: event.id, type: event.type, status: "PROCESSING" }
    });

    let pendingTransferObj: {
      amount: number;
      destination: string;
      description: string;
      idempotencyKey: string;
    } | null = null;

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;
      const metadata = session.metadata;

      if (metadata && metadata.sponsorshipId) {
        const sponsorship = await tx.workSponsorship.findUnique({
          where: { id: metadata.sponsorshipId }
        });

        if (sponsorship && sponsorship.status === 'PENDING') {
          await tx.workSponsorship.update({
            where: { id: sponsorship.id },
            data: { 
              status: 'ACTIVE',
              stripeSubscriptionId: session.subscription,
              stripeCustomerId: session.customer as string
            }
          });

          // Lógica de Split de Receita
          const work = await tx.work.findUnique({ 
            where: { id: sponsorship.workId },
            include: { tenant: true }
          });

          if (work && work.tenant) {
            const amountReceived = (session.amount_total || 0); // em centavos
            const platformFee = amountReceived * (sponsorship.platformFeePercent / 100);
            const netAmount = amountReceived - platformFee;

            // Log FinancialTransaction for auditing
            const finTx = await tx.financialTransaction.create({
              data: {
                tenantId: work.tenantId,
                type: "PAYMENT",
                source: "SPONSORSHIP",
                amount: amountReceived / 100,
                fee: platformFee / 100,
                netAmount: netAmount / 100,
                status: "COMPLETED",
                paymentMethod: "CREDIT_CARD",
                stripePaymentIntentId: session.payment_intent as string
              }
            });

            await syncLedgerEntry(tx, finTx.id);

            // Repasse
            let connectAccountId: string | null = null;
            if (work.tenant.isPublicInstitution && work.tenant.parentId) {
              const secretaria = await tx.tenant.findUnique({ where: { id: work.tenant.parentId } });
              if (secretaria?.stripeConnectId) {
                connectAccountId = secretaria.stripeConnectId;
              }
            } else if (!work.tenant.isPublicInstitution && work.tenant.stripeConnectId) {
              connectAccountId = work.tenant.stripeConnectId;
            }

            let payoutLedgerId: string | null = null;
            if (connectAccountId) {
              const payout = await tx.payoutLedger.create({
                data: {
                  tenantId: work.tenantId,
                  recipientType: "SPONSOR",
                  recipientId: connectAccountId,
                  sourceTransactionId: finTx.id,
                  grossAmount: amountReceived / 100,
                  platformFee: platformFee / 100,
                  gatewayFee: 0,
                  netAmount: netAmount / 100,
                  status: "PROCESSING",
                  availableAt: new Date()
                }
              });
              payoutLedgerId = payout.id;
            }

            return {
              duplicate: false,
              payoutLedgerId,
              netAmount,
              connectAccountId,
              sponsorshipId: sponsorship.id
            };
          }
        }
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as any;
      await tx.workSponsorship.updateMany({
        where: { stripeSubscriptionId: subscription.id },
        data: { status: 'EXPIRED', active: false, endDate: new Date() }
      });
    }

    // 3. Mark as PROCESSED
    await tx.stripeWebhookEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED" }
    });

    return {
      duplicate: false,
      payoutLedgerId: null,
      netAmount: null,
      connectAccountId: null,
      sponsorshipId: null
    };
  });

  // Executar a transferência para a conta Connect fora da transação de banco de dados
  if (result.payoutLedgerId && result.netAmount && result.connectAccountId) {
    try {
      console.log(`[Stripe Sponsor Webhook] Executing outbox transfer for PayoutLedger ${result.payoutLedgerId}...`);
      const transfer = await stripe.transfers.create({
        amount: Math.round(result.netAmount),
        currency: 'brl',
        destination: result.connectAccountId,
        description: `Repasse Patrocínio: PayoutLedger ${result.payoutLedgerId}`
      }, {
        idempotencyKey: `transfer-sponsor-payout-${result.payoutLedgerId}`
      });

      await prisma.payoutLedger.update({
        where: { id: result.payoutLedgerId },
        data: {
          status: "PAID",
          stripeTransferId: transfer.id,
          paidAt: new Date()
        }
      });
      console.log(`[Stripe Sponsor Webhook] Outbox transfer successful!`);
    } catch (err: any) {
      console.error(`[Stripe Sponsor Webhook Error] Outbox transfer failed:`, err.message);
      await prisma.payoutLedger.update({
        where: { id: result.payoutLedgerId },
        data: {
          status: "FAILED"
        }
      }).catch(dbErr => console.error("Failed to update payoutLedger status to FAILED:", dbErr.message));
    }
  }

  return result;
}

/**
 * Reprocess a sponsorship webhook event (MASTER only)
 */
router.post("/reprocess/:eventId", authMiddleware, requireRole([Role.MASTER]), async (req: Request, res: Response): Promise<any> => {
  const { eventId } = req.params;

  const dbEvent = await prisma.stripeWebhookEvent.findUnique({
    where: { id: eventId }
  });

  if (!dbEvent) {
    return res.status(404).json({ message: "Evento de webhook não encontrado no banco de dados." });
  }

  try {
    console.log(`[Stripe Sponsor Webhook Reprocess] Fetching event ${eventId} from Stripe API...`);
    const event = await stripe.events.retrieve(eventId);

    // Reset status to PROCESSING
    await prisma.stripeWebhookEvent.update({
      where: { id: eventId },
      data: { status: "PROCESSING", errorMessage: null }
    });

    const result = await handleSponsorWebhookEvent(event);

    return res.json({ 
      message: "Webhook de patrocínio reprocessado com sucesso", 
      status: result.duplicate ? "DUPLICATE" : "PROCESSED" 
    });
  } catch (err: any) {
    console.error(`[Stripe Sponsor Webhook Reprocess Error]:`, err);
    await prisma.stripeWebhookEvent.update({
      where: { id: eventId },
      data: { status: "FAILED", errorMessage: err?.message || String(err) }
    });
    return res.status(500).json({ message: "Erro ao reprocessar webhook de patrocínio", error: err?.message });
  }
});

export default router;
