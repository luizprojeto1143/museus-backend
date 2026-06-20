import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, softAuthMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { stripe } from "../services/stripeService.js";

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
        tenantId: work.tenantId
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
    // Identificar patrocínios pelo email do usuário logado (simplificação)
    const sponsorships = await prisma.workSponsorship.findMany({
      where: { sponsorEmail: user.email },
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

    if (sponsorship.sponsorEmail !== user.email && user.role !== Role.MASTER) {
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
      (req as any).rawBody || JSON.stringify(req.body),
      sig as string,
      endpointSecret as string
    );
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;
      const metadata = session.metadata;

      if (metadata && metadata.sponsorshipId) {
        const sponsorship = await prisma.workSponsorship.findUnique({
          where: { id: metadata.sponsorshipId }
        });

        if (sponsorship && sponsorship.status === 'PENDING') {
          await prisma.workSponsorship.update({
            where: { id: sponsorship.id },
            data: { 
              status: 'ACTIVE',
              stripeSubscriptionId: session.subscription,
              stripeCustomerId: session.customer as string
            }
          });

          // Lógica de Split de Receita
          const work = await prisma.work.findUnique({ 
            where: { id: sponsorship.workId },
            include: { tenant: true }
          });

          if (work && work.tenant) {
            const amountReceived = (session.amount_total || 0); // em centavos
            const platformFee = amountReceived * (sponsorship.platformFeePercent / 100);
            const netAmount = amountReceived - platformFee;

            if (work.tenant.isPublicInstitution && work.tenant.parentId) {
              const secretaria = await prisma.tenant.findUnique({ where: { id: work.tenant.parentId } });
              if (secretaria && secretaria.stripeConnectId) {
                await stripe.transfers.create({
                  amount: Math.round(netAmount),
                  currency: 'brl',
                  destination: secretaria.stripeConnectId,
                  description: `Repasse Patrocínio: ${work.title}`
                });
              }
            } else if (!work.tenant.isPublicInstitution && work.tenant.stripeConnectId) {
              await stripe.transfers.create({
                amount: Math.round(netAmount),
                currency: 'brl',
                destination: work.tenant.stripeConnectId,
                description: `Repasse Patrocínio: ${work.title}`
              });
            }
          }
        }
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as any;
      await prisma.workSponsorship.updateMany({
        where: { stripeSubscriptionId: subscription.id },
        data: { status: 'EXPIRED', active: false, endDate: new Date() }
      });
    }
  } catch (error) {
    console.error("Erro processando webhook sponsor-portal:", error);
    return res.status(500).send("Internal Server Error");
  }

  return res.status(200).send({ received: true });
});

export default router;
