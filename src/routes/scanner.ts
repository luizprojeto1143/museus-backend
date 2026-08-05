import { Router } from "express";
import { Role } from "@prisma/client";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const router = Router();

function canAccessTenant(req: any, tenantId: string) {
  return req.user?.role === Role.MASTER || req.user?.tenantId === tenantId;
}

router.get("/models/:tenantId", authMiddleware, async (req: any, res) => {
  const { tenantId } = req.params;
  if (!canAccessTenant(req, tenantId)) {
    return res.status(403).json({ message: "Sem permissao para acessar este modelo" });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { accessibilityResources: true }
  });

  if (!tenant) return res.status(404).json({ message: "Tenant nao encontrado" });

  const resources = (tenant.accessibilityResources || {}) as Record<string, any>;
  return res.json(resources.scannerModel || null);
});

router.put("/models/:tenantId", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), async (req: any, res) => {
  const { tenantId } = req.params;
  if (!canAccessTenant(req, tenantId)) {
    return res.status(403).json({ message: "Sem permissao para salvar este modelo" });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { accessibilityResources: true }
  });

  if (!tenant) return res.status(404).json({ message: "Tenant nao encontrado" });

  const resources = (tenant.accessibilityResources || {}) as Record<string, any>;
  const scannerModel = {
    dataset: req.body.dataset || {},
    exampleCounts: req.body.exampleCounts || {},
    updatedAt: req.body.updatedAt || new Date().toISOString()
  };

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      accessibilityResources: {
        ...resources,
        scannerModel
      }
    }
  });

  return res.json({ success: true, scannerModel });
});

export default router;
