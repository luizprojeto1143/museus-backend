import { Router } from "express";
import { Role } from "@prisma/client";
import { RoteiroController } from "./roteiro.controller.js";
import { authMiddleware, requireRole, softAuthMiddleware } from "../../middleware/auth.js";
import { aiLimiter } from "../../middleware/rateLimiter.js";

const router = Router({ mergeParams: true });
const roteiroController = new RoteiroController();

router.get("/routes", roteiroController.getRoutes);
router.post("/routes/ai-generate", softAuthMiddleware, aiLimiter, roteiroController.generateAIAssistedRoute);
router.post("/intelligent", softAuthMiddleware, aiLimiter, roteiroController.generateAIAssistedRoute);
router.post("/ai-generate", softAuthMiddleware, aiLimiter, roteiroController.generateAIAssistedRoute);

router.get("/providers/admin", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), roteiroController.getServiceProvidersAdmin);
router.get("/providers/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), roteiroController.getServiceProviderAdmin);
router.post("/providers", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), roteiroController.createServiceProvider);
router.put("/providers/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), roteiroController.updateServiceProvider);
router.delete("/providers/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), roteiroController.deleteServiceProvider);
router.get("/providers", roteiroController.getServiceProviders);

export { router as scopedRoteiroRoutes };
