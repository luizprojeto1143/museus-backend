import { Router } from "express";
import { prisma } from "../prisma";
import { authMiddleware as authenticate, requireRole as authorize } from "../middleware/auth";

const router = Router();

// Visitor: Request physical badge
router.post("/", authenticate, async (req, res) => {
  const { visitorId, tenantId, addressName, addressStreet, addressCity, addressState, addressZip } = req.body;

  const visitor = await prisma.visitor.findUnique({
    where: { id: visitorId },
    include: { skins: { where: { equipped: true }, include: { skin: true } } }
  });

  if (!visitor) return res.status(404).json({ error: "Visitor not found" });
  if (visitor.xp < 100000) return res.status(400).json({ error: "Insufficient XP (min 100k)" });

  const equippedSkin = visitor.skins[0]?.skin?.imageUrl || "default_avatar.png";

  const request = await prisma.badgeRequest.create({
    data: {
      visitorId,
      tenantId,
      level: 1, // Logic for levels based on XP can be added here
      skinImageUrl: equippedSkin,
      xpAtRequest: visitor.xp,
      addressName,
      addressStreet,
      addressCity,
      addressState,
      addressZip
    }
  });

  res.json(request);
});

// Master: List and Approve Badge Requests
router.get("/queue", authenticate, authorize(["MASTER"]), async (req, res) => {
  const requests = await prisma.badgeRequest.findMany({
    include: { visitor: true, tenant: true }
  });
  res.json(requests);
});

router.put("/:id/status", authenticate, authorize(["MASTER"]), async (req, res) => {
  const { status, trackingCode } = req.body;
  const request = await prisma.badgeRequest.update({
    where: { id: req.params.id },
    data: { 
      status, 
      trackingCode,
      approvedAt: status === "APPROVED" ? new Date() : undefined,
      shippedAt: status === "SHIPPED" ? new Date() : undefined,
      deliveredAt: status === "DELIVERED" ? new Date() : undefined
    }
  });
  res.json(request);
});

export default router;
