import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role, QRType } from "@prisma/client";
import crypto from "crypto";
import { z } from "zod";

const router = Router();

// Lista QR Codes de um tenant
router.get("/", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
  try {
    const user = req.user!;
    let tenantId = req.query.tenantId as string | undefined;

    if (user.role === Role.ADMIN) {
      tenantId = user.tenantId || undefined;
    }

    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }

    const qrs = await prisma.qRCode.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" }
    });
    return res.json(qrs);
  } catch (err) {
    console.error("Erro listar QR Codes", err);
    return res.status(500).json({ message: "Erro ao listar QR Codes" });
  }
});

// Criar QR Code
router.post("/", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
  try {
    const user = req.user!;
    const qrSchema = z.object({
      type: z.nativeEnum(QRType),
      referenceId: z.string().optional(),
      title: z.string().optional(),
      xpReward: z.number().int().min(0).optional(),
      tenantId: z.string().optional(),
      code: z.string().optional()
    });

    const data = qrSchema.parse(req.body);
    let tenantId = data.tenantId;

    if (user.role === Role.ADMIN) {
      tenantId = user.tenantId || undefined;
    }

    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }

    // Se customCode foi enviado, verificar unicidade
    if (data.code) {
      const existing = await prisma.qRCode.findUnique({ where: { code: data.code } });
      if (existing) {
        return res.status(400).json({ message: "Este código já está em uso." });
      }
    }

    const code = data.code || crypto.randomBytes(6).toString("hex");
    const qr = await prisma.qRCode.create({
      data: {
        code,
        type: data.type,
        referenceId: data.referenceId || null,
        title: data.title || "QR Code",
        xpReward: data.xpReward ?? 5,
        tenantId
      }
    });

    return res.status(201).json(qr);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
    }
    console.error("Erro criar QR Code", err);
    return res.status(500).json({ message: "Erro ao criar QR Code" });
  }
});

// Delete
router.delete("/:id", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.qRCode.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    console.error("Erro excluir QR Code", err);
    return res.status(500).json({ message: "Erro ao excluir QR Code" });
  }
});

export default router;
