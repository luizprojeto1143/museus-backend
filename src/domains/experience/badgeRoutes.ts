import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware as authenticate, requireRole as authorize } from "../../middleware/auth.js";
import { emailService } from "../../services/EmailService.js";
import { BadgeService } from "../../services/badgeService.js";
import { checkEntityOwnership } from "../../utils/ownership.js";

const router = Router();

// Visitor: Get my badge requests
router.get("/my", authenticate, async (req, res) => {
  try {
    const userEmail = req.user!.email;
    const tenantId = req.user!.tenantId as string;
    const visitor = await prisma.visitor.findFirst({ where: { email: userEmail, tenantId: tenantId as string } });
    if (!visitor) return res.status(404).json({ error: "Visitor not found" });

    const requests = await (prisma as any).badgeRequest.findMany({
      where: { visitorId: visitor.id },
      orderBy: { requestedAt: "desc" }
    });
    res.json(requests);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error fetching badge requests" });
  }
});

// Visitor: Request physical badge
router.post("/", authenticate, async (req, res) => {
  try {
    const { addressName, addressStreet, addressCity, addressState, addressZip } = req.body;
    const userEmail = req.user!.email;
    const tenantId = req.user!.tenantId as string;

    // C1 Fix: Derive visitorId from JWT
    const visitor = await prisma.visitor.findFirst({
      where: { email: userEmail, tenantId },
      include: { visitorRPGs: { where: { isActive: true }, include: { skin: true } } }
    });

    if (!visitor) return res.status(404).json({ error: "Visitante não encontrado" });
    if (visitor.xp < 100000) return res.status(400).json({ error: "XP insuficiente (mínimo 100k)" });

    // C2 Fix: Check for existing pending/active request
    const existing = await (prisma as any).badgeRequest.findFirst({
      where: {
        visitorId: visitor.id,
        status: { notIn: ["REJECTED", "DELIVERED"] }
      }
    });

    if (existing) {
      return res.status(400).json({ 
        error: "Você já possui uma solicitação de crachá em andamento.",
        status: existing.status
      });
    }

    const equippedSkin = visitor?.visitorRPGs[0]?.skin?.imageUrl || "default_avatar.png";

    // L2 Backend Logic: Bronze=100k, Prata=250k, Ouro=500k, Platina=1M
    let level = 1; // Bronze
    const xp = visitor.xp;
    if (xp >= 1000000) level = 4; // Platina
    else if (xp >= 500000) level = 3; // Ouro
    else if (xp >= 250000) level = 2; // Prata

    const request = await (prisma as any).badgeRequest.create({
      data: {
        visitorId: visitor.id,
        tenantId,
        level,
        skinImageUrl: equippedSkin,
        xpAtRequest: visitor.xp,
        addressName,
        addressStreet,
        addressCity,
        addressState,
        addressZip
      }
    });

    res.status(201).json(request);
  } catch (error) {
    console.error("Error creating badge request:", error);
    res.status(500).json({ error: "Erro ao solicitar crachá" });
  }
});

// Master: List and Approve Badge Requests
router.get("/queue", authenticate, authorize(["MASTER"]), async (req, res) => {
  try {
    const requests = await (prisma as any).badgeRequest.findMany({
      include: { visitor: true, tenant: true },
      orderBy: { requestedAt: "desc" }
    });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar fila" });
  }
});

router.put("/:id/status", authenticate, authorize(["MASTER"]), async (req, res) => {
  try {
    const { status, trackingCode } = req.body;
    const request = await (prisma as any).badgeRequest.update({
      where: { id: req.params.id },
      data: { 
        status, 
        trackingCode,
        approvedAt: status === "APPROVED" ? new Date() : undefined,
        shippedAt: status === "SHIPPED" ? new Date() : undefined,
        deliveredAt: status === "DELIVERED" ? new Date() : undefined
      },
      include: { visitor: true }
    });

    // I5: Integrar Notificações (Real via serviço de e-mail)
    console.log(`Badge Request ${request.id} status changed to ${status} for visitor ${request.visitor.email}`);
    if (request.visitor.email) {
      emailService.sendBadgeUpdate(request.visitor.email, status, request.visitor.name || "Visitante");
    }

    res.json(request);
  } catch (error) {
    res.status(500).json({ error: "Erro ao atualizar status" });
  }
});

// I4: GET /badges/:id/print — Gera o crachá físico (PDF) para impressão profissional
router.get("/:id/print", authenticate, authorize(["MASTER", "ADMIN"]), async (req, res) => {
  try {
    const check = await checkEntityOwnership('badgeRequest', req.params.id, req.user!);
    if (!check.success) return res.status(check.status).json({ error: check.message });

    const pdfBuffer = await BadgeService.generatePDF(req.params.id);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="badge-${req.params.id}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Error generating badge PDF:", error);
    res.status(500).json({ error: "Erro ao gerar crachá para impressão" });
  }
});

export default router;
