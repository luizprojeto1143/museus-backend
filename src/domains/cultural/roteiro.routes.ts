import { Router } from "express";
import { RoteiroController } from "./roteiro.controller.js";

const router = Router();
const roteiroController = new RoteiroController();

// Rotas públicas de exploração para visitantes no app mobile
router.get("/:tenantSlug/routes", roteiroController.getRoutes);
router.post("/:tenantSlug/routes/ai-generate", roteiroController.generateAIAssistedRoute);

// Marketplace de Serviços Locais
router.get("/:tenantSlug/providers", roteiroController.getServiceProviders);

// Em um ambiente de produção real, as reservas precisam de autenticação de Visitante
// Exemplo: router.post("/:tenantSlug/book", authenticateVisitor, roteiroController.bookService);

export { router as roteiroRoutes };
