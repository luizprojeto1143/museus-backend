import { Router } from "express";
import { SkinPurchaseStatus, SkinPurchaseType, XpTransactionType } from "@prisma/client";
import { authMiddleware as authenticate } from "../../middleware/auth.js";
import { prisma } from "../../prisma.js";
import { stripeService } from "../../services/stripeService.js";

const router = Router();

async function getAuthenticatedVisitor(req: any) {
  const userEmail = req.user?.email;
  const tenantId = req.user?.tenantId;

  if (!userEmail) {
    return { visitor: null, tenantId, errorStatus: 401, error: "Nao autorizado" };
  }

  const visitor = await prisma.visitor.findFirst({
    where: {
      email: userEmail.toLowerCase(),
      tenantId
    }
  });

  if (!visitor) {
    return { visitor: null, tenantId, errorStatus: 404, error: "Visitante nao encontrado" };
  }

  return { visitor, tenantId, errorStatus: null, error: null };
}

async function findAvailableSkin(skinId: string, tenantId?: string | null) {
  return prisma.skin.findFirst({
    where: {
      id: skinId,
      active: true,
      OR: [
        { tenantId: null },
        { tenantId }
      ]
    }
  });
}

router.get("/", authenticate, async (req, res) => {
  try {
    const { visitor, tenantId, errorStatus, error } = await getAuthenticatedVisitor(req);
    if (!visitor) return res.status(errorStatus || 401).json({ error });

    const skins = await prisma.skin.findMany({
      where: {
        active: true,
        eventOnly: false,
        OR: [
          { tenantId: null },
          { tenantId }
        ]
      },
      include: {
        characterBase: true,
        visitorSkins: {
          where: { visitorId: visitor.id }
        }
      }
    });

    res.json(skins.map((skin: any) => ({
      ...skin,
      owned: skin.visitorSkins?.length > 0
    })));
  } catch (err) {
    console.error("[marketplace] GET / error:", err);
    res.status(500).json({ error: "Erro ao listar marketplace" });
  }
});

const buySkinWithXp = async (req: any, res: any) => {
  try {
    const { skinId } = req.params;
    const { visitor, tenantId, errorStatus, error } = await getAuthenticatedVisitor(req);
    if (!visitor) return res.status(errorStatus || 401).json({ error });

    const skin = await findAvailableSkin(skinId, tenantId);
    if (!skin) return res.status(404).json({ error: "Skin nao encontrada" });

    const allowedXp = ["FREE", "XP_ONLY", "XP_OR_MONEY", "XP_PLUS_MONEY"].includes(skin.acquisitionMode);
    if (!allowedXp) {
      return res.status(400).json({ error: "Esta skin nao pode ser comprada com XP" });
    }

    if (skin.acquisitionMode === "XP_PLUS_MONEY") {
      return res.status(400).json({ error: "Esta skin exige XP e pagamento. Use o checkout hibrido." });
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.visitorSkin.findUnique({
        where: { visitorId_skinId: { visitorId: visitor.id, skinId } }
      });
      if (existing) throw new Error("ALREADY_OWNED");

      const updated = await tx.visitor.updateMany({
        where: {
          id: visitor.id,
          xp: { gte: skin.xpCost }
        },
        data: {
          xp: { decrement: skin.xpCost }
        }
      });

      if (updated.count === 0) throw new Error("INSUFFICIENT_XP");

      const updatedVisitor = await tx.visitor.findUnique({
        where: { id: visitor.id },
        select: { xp: true }
      });

      const purchase = await tx.skinPurchase.create({
        data: {
          tenantId,
          visitorId: visitor.id,
          skinId,
          purchaseType: SkinPurchaseType.XP,
          status: SkinPurchaseStatus.PAID,
          xpAmount: skin.xpCost,
          paidAt: new Date()
        }
      });

      await tx.xpTransaction.create({
        data: {
          visitorId: visitor.id,
          type: XpTransactionType.SPEND,
          amount: -skin.xpCost,
          balanceAfter: updatedVisitor?.xp ?? 0,
          reason: `Compra de skin: ${skin.name}`,
          sourceType: "SKIN_PURCHASE",
          sourceId: purchase.id
        }
      });

      await tx.visitorSkin.create({
        data: {
          visitorId: visitor.id,
          skinId,
          sourcePurchaseId: purchase.id
        }
      });
    });

    const updatedVisitor = await prisma.visitor.findUnique({ where: { id: visitor.id } });
    res.json({ success: true, newXpBalance: updatedVisitor?.xp });
  } catch (err: any) {
    console.error("[marketplace] POST /:skinId/buy-xp error:", err);

    if (err.message === "ALREADY_OWNED") return res.status(400).json({ error: "Voce ja possui esta skin" });
    if (err.message === "INSUFFICIENT_XP") return res.status(400).json({ error: "XP insuficiente" });

    res.status(500).json({ error: "Erro ao processar compra por XP" });
  }
};

router.post("/:skinId/buy-xp", authenticate, buySkinWithXp);
router.post("/:skinId/buy", authenticate, buySkinWithXp);

router.post("/:skinId/buy-money", authenticate, async (req, res) => {
  try {
    const { skinId } = req.params;
    const { visitor, tenantId, errorStatus, error } = await getAuthenticatedVisitor(req);
    if (!visitor) return res.status(errorStatus || 401).json({ error });

    const skin = await findAvailableSkin(skinId, tenantId);
    if (!skin) return res.status(404).json({ error: "Skin nao encontrada" });

    const allowedMoney = ["MONEY_ONLY", "XP_OR_MONEY", "XP_PLUS_MONEY"].includes(skin.acquisitionMode);
    if (!allowedMoney) {
      return res.status(400).json({ error: "Esta skin nao pode ser comprada com dinheiro" });
    }

    const existing = await prisma.visitorSkin.findUnique({
      where: { visitorId_skinId: { visitorId: visitor.id, skinId } }
    });
    if (existing) return res.status(400).json({ error: "Voce ja possui esta skin" });

    const priceCents = skin.priceCents || 0;
    if (priceCents <= 0) {
      return res.status(400).json({ error: "Preco invalido para venda monetaria" });
    }

    const hybridXpCost = skin.acquisitionMode === "XP_PLUS_MONEY" ? skin.xpCost : 0;
    if (hybridXpCost > 0 && visitor.xp < hybridXpCost) {
      return res.status(400).json({ error: "XP insuficiente para esta compra hibrida" });
    }

    const customerId = await stripeService.createCustomer({
      name: visitor.name || visitor.email || "Visitante",
      email: visitor.email || (req as any).user.email,
      userId: visitor.id
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const successUrl = `${frontendUrl}/guarda-roupa?skinPurchase=success`;
    const cancelUrl = `${frontendUrl}/marketplace?skinPurchase=cancel`;

    const session = await stripeService.createPlatformPaymentSession({
      customerId,
      amount: priceCents,
      description: `Skin Premium: ${skin.name}`,
      successUrl,
      cancelUrl,
      metadata: {
        visitorId: visitor.id,
        skinId: skin.id,
        tenantId: tenantId || "",
        xpAmount: String(hybridXpCost),
        purchaseMode: skin.acquisitionMode
      }
    });

    await prisma.skinPurchase.create({
      data: {
        tenantId,
        visitorId: visitor.id,
        skinId,
        purchaseType: SkinPurchaseType.MONEY,
        status: SkinPurchaseStatus.PENDING,
        xpAmount: hybridXpCost > 0 ? hybridXpCost : null,
        moneyAmountCents: priceCents,
        stripeCheckoutSessionId: session.id
      }
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error("[marketplace] POST /:skinId/buy-money error:", err);
    res.status(500).json({ error: "Erro ao processar checkout monetario" });
  }
});

export default router;
