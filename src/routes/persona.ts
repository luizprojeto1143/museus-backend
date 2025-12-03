import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// Obter persona do tenant
router.get("/:tenantId", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { tenantId } = req.params;
    const persona = await prisma.chatPersona.findUnique({ where: { tenantId } });
    return res.json(persona);
  } catch (err) {
    console.error("Erro obter persona", err);
    return res.status(500).json({ message: "Erro ao obter persona" });
  }
});

// Definir persona do tenant
router.post("/:tenantId", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { systemPrompt } = req.body as { systemPrompt?: string };
    if (!systemPrompt) {
      return res.status(400).json({ message: "systemPrompt é obrigatório" });
    }

    const persona = await prisma.chatPersona.upsert({
      where: { tenantId },
      update: { systemPrompt },
      create: { tenantId, systemPrompt }
    });

    return res.json(persona);
  } catch (err) {
    console.error("Erro salvar persona", err);
    return res.status(500).json({ message: "Erro ao salvar persona" });
  }
});

export default router;
