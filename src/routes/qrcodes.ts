import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role, QRType } from "@prisma/client";
import crypto from "crypto";

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
    const { type, referenceId, title, xpReward, tenantId: bodyTenantId } = req.body as {
      type: QRType;
      referenceId?: string;
      title?: string;
      xpReward?: number;
      tenantId?: string;
    };

    let tenantId = bodyTenantId;
    if (user.role === Role.ADMIN) {
      tenantId = user.tenantId || undefined;
    }

    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }

    if (!type) {
      return res.status(400).json({ message: "type é obrigatório" });
    }

    const code = crypto.randomBytes(6).toString("hex");
    const qr = await prisma.qRCode.create({
      data: {
        code,
        type,
        referenceId: referenceId || null,
        title: title || "QR Code",
        xpReward: typeof xpReward === "number" ? xpReward : 5,
        tenantId
      }
    });

    return res.status(201).json(qr);
  } catch (err) {
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
