import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// GET /platform/settings/financial
router.get("/settings/financial", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    const user = req.user!;
    const masterUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { stripeConnectId: true }
    });

    res.json({
      stripeConnectId: masterUser?.stripeConnectId || null,
      platformFee: 10 // Padrão da plataforma de 10%
    });
  } catch (error) {
    console.error("Erro ao buscar configurações financeiras globais:", error);
    res.status(500).json({ message: "Erro ao consultar configurações financeiras" });
  }
});

// PUT /platform/settings/financial
router.put("/settings/financial", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    const user = req.user!;
    const { stripeConnectId } = req.body;

    const masterUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        stripeConnectId: stripeConnectId || null
      },
      select: { id: true, stripeConnectId: true }
    });

    res.json({
      success: true,
      stripeConnectId: masterUser.stripeConnectId
    });
  } catch (error) {
    console.error("Erro ao salvar configurações financeiras globais:", error);
    res.status(500).json({ message: "Erro ao salvar configurações financeiras" });
  }
});

export const platformRouter = router;
export default router;
