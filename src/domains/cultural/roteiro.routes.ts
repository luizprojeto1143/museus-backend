import { Router } from "express";
import { RoteiroController } from "./roteiro.controller.js";
import { authMiddleware, requireRole, softAuthMiddleware } from "../../middleware/auth.js";
import { aiLimiter } from "../../middleware/rateLimiter.js";
import { Role } from "@prisma/client";

const router = Router({ mergeParams: true });
const roteiroController = new RoteiroController();

router.get("/:tenantSlug/routes", roteiroController.getRoutes);
router.post("/:tenantSlug/routes/ai-generate", softAuthMiddleware, aiLimiter, roteiroController.generateAIAssistedRoute);
router.post("/:tenantSlug/intelligent", softAuthMiddleware, aiLimiter, roteiroController.generateAIAssistedRoute);
router.post("/ai-generate", softAuthMiddleware, aiLimiter, roteiroController.generateAIAssistedRoute);

router.get("/:tenantSlug/providers/admin", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), roteiroController.getServiceProvidersAdmin);
router.get("/:tenantSlug/providers/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), roteiroController.getServiceProviderAdmin);
router.post("/:tenantSlug/providers", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), roteiroController.createServiceProvider);
router.put("/:tenantSlug/providers/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), roteiroController.updateServiceProvider);
router.delete("/:tenantSlug/providers/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), roteiroController.deleteServiceProvider);
router.get("/:tenantSlug/providers", roteiroController.getServiceProviders);

export { router as roteiroRoutes };
