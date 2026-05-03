import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware as authenticate } from "../middleware/auth.js";

const router = Router();

// Visitor: List available skins for purchase
router.get("/", authenticate, async (req, res) => {
  try {
    const { visitorId } = req.query;
    const tenantId = (req as any).user?.tenantId;

    const skins = await prisma.skin.findMany({
      where: {
        active: true,
        OR: [
          { tenantId: null },
          { tenantId: tenantId ?? undefined }
        ]
      },
      include: {
        characterBase: true,
        owners: visitorId ? { where: { visitorId: String(visitorId) } } : false
      }
    });

    const formatted = skins.map((s: any) => ({
      ...s,
      owned: s.owners?.length > 0
    }));

    res.json(formatted);
  } catch (err) {
    // C7: Catch DB/validation errors to prevent unhandled rejection propagation
    console.error("[marketplace] GET / error:", err);
    res.status(500).json({ error: "Erro ao listar marketplace" });
  }
});

// Buy skin with XP
router.post("/:skinId/buy", authenticate, async (req, res) => {
  try {
    const { skinId } = req.params;
    const userEmail = (req as any).user?.email;
    const tenantId = (req as any).user?.tenantId;

    if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

    // B-02: Derive visitorId from JWT instead of trusting request body
    const visitor = await prisma.visitor.findFirst({
      where: {
        email: userEmail.toLowerCase(),
        tenantId: tenantId
      }
    });

    const skin = await prisma.skin.findFirst({ 
      where: { 
        id: skinId,
        OR: [
          { tenantId: null },
          { tenantId: tenantId }
        ]
      } 
    });

    if (!visitor || !skin) return res.status(404).json({ error: "Not found" });
    if (visitor.xp < skin.xpCost) return res.status(400).json({ error: "Insufficient XP" });

    const existing = await prisma.visitorSkin.findUnique({
      where: { visitorId_skinId: { visitorId: visitor.id, skinId } }
    });
    if (existing) return res.status(400).json({ error: "Already owned" });

    const [updatedVisitor] = await prisma.$transaction([
      prisma.visitor.update({
        where: { id: visitor.id },
        data: { xp: { decrement: skin.xpCost } }
      }),
      prisma.visitorSkin.create({
        data: { visitorId: visitor.id, skinId }
      })
    ]);

    res.json({ success: true, newXpBalance: updatedVisitor.xp });
  } catch (err) {
    // C7: Catch DB/validation errors to prevent unhandled rejection propagation
    console.error("[marketplace] POST /:skinId/buy error:", err);
    res.status(500).json({ error: "Erro ao processar compra" });
  }
});

export default router;
