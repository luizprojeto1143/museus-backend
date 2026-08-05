import { Router } from "express";
import { Role } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";

const router = Router();

function targetTenant(req: any, requestedTenantId?: string) {
  return req.user!.role === Role.MASTER ? requestedTenantId : req.user!.tenantId;
}

// GET /vestige-alerts - List alerts for a tenant
router.get("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = targetTenant(req, req.query.tenantId as string | undefined);
    if (!tenantId) return res.status(400).json({ message: "tenantId obrigatorio" });

    const alerts = await (prisma as any).vestigeAlert.findMany({
      where: {
        tenantId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gte: new Date() } }
        ]
      },
      orderBy: { createdAt: "desc" }
    });

    return res.json(alerts);
  } catch (err) {
    console.error("Erro ao listar alertas:", err);
    return res.status(500).json({ message: "Erro ao listar alertas" });
  }
});

// POST /vestige-alerts - Create alert
router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { tenantId: requestedTenantId, titulo, mensagem, tipo, link, expiresAt } = req.body;
    const tenantId = targetTenant(req, requestedTenantId);
    if (!tenantId) return res.status(400).json({ message: "tenantId obrigatorio" });

    const alert = await (prisma as any).vestigeAlert.create({
      data: {
        tenantId,
        titulo,
        mensagem,
        tipo: tipo || "URGENTE",
        link,
        expiresAt: expiresAt ? new Date(expiresAt) : null
      }
    });

    return res.status(201).json(alert);
  } catch (err) {
    console.error("Erro ao criar alerta:", err);
    return res.status(500).json({ message: "Erro ao criar alerta" });
  }
});

export default router;
