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
        // I2 Fix: Skins de evento exclusivo não devem aparecer no marketplace geral 
        // a menos que haja uma lógica específica futura. Por enquanto, filtramos.
        eventOnly: false, 
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

    const visitor = await prisma.visitor.findFirst({
      where: {
        email: userEmail.toLowerCase(),
        tenantId: tenantId
      }
    });

    const skin = await prisma.skin.findFirst({ 
      where: { 
        id: skinId,
        active: true,
        OR: [
          { tenantId: null },
          { tenantId: tenantId }
        ]
      } 
    });

    if (!visitor || !skin) return res.status(404).json({ error: "Not found" });

    // C4 Fix: Move logic to transaction to prevent race conditions
    // Use updateMany with XP condition to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // 1. Check if already owned
      const existing = await tx.visitorSkin.findUnique({
        where: { visitorId_skinId: { visitorId: visitor.id, skinId } }
      });
      if (existing) throw new Error("ALREADY_OWNED");

      // 2. Atomic decrement with check
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

      // 3. Create ownership
      return await tx.visitorSkin.create({
        data: { visitorId: visitor.id, skinId }
      });
    });

    // Fetch updated balance for response
    const updatedVisitor = await prisma.visitor.findUnique({ where: { id: visitor.id } });

    res.json({ success: true, newXpBalance: updatedVisitor?.xp });
  } catch (err: any) {
    console.error("[marketplace] POST /:skinId/buy error:", err);
    
    if (err.message === "ALREADY_OWNED") return res.status(400).json({ error: "Você já possui esta skin" });
    if (err.message === "INSUFFICIENT_XP") return res.status(400).json({ error: "XP insuficiente" });

    res.status(500).json({ error: "Erro ao processar compra" });
  }
});

export default router;
