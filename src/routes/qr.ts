import { Router } from "express";
import { prisma } from "../prisma.js";

const router = Router();

// Busca informações de um QR Code a partir do código
router.get("/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const qr = await prisma.qRCode.findUnique({
      where: { code }
    });
    if (!qr) {
      return res.status(404).json({ message: "QR Code não encontrado" });
    }
    return res.json(qr);
  } catch (err) {
    console.error("Erro buscar QR", err);
    return res.status(500).json({ message: "Erro ao buscar QR" });
  }
});

export default router;
