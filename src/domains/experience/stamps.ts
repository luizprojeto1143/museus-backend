import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { visitorId, workId } = req.body as {
      visitorId?: string;
      workId?: string;
    };

    if (!visitorId || !workId) {
      return res.status(400).json({ message: "visitorId e workId são obrigatórios" });
    }

    // 3. Verificar se já capturou
    const existing = await (prisma.passportStamp as any).findUnique({
      where: {
        visitorId_workId: { visitorId, workId }
      }
    });

    if (existing) {
      return res.json({ message: "Carimbo já existe", stamp: existing });
    }

    const stamp = await (prisma.passportStamp as any).create({
      data: {
        visitorId,
        workId,
        raridade: "COMMON", // Default para carimbos legados/simples
        numeroCaptura: 0,
        xpGanho: 50
      },
      include: {
        work: true
      }
    });

    return res.status(201).json(stamp);
  } catch (err) {
    console.error("Erro ao criar carimbo", err);
    return res.status(500).json({ message: "Erro ao criar carimbo" });
  }
});

router.get("/visitor/:visitorId", async (req, res) => {
  try {
    const { visitorId } = req.params;

    const stamps = await prisma.passportStamp.findMany({
      where: { visitorId },
      include: {
        work: {
          select: {
            id: true,
            title: true,
            artist: true,
            imageUrl: true
          }
        }
      },
      orderBy: { stampedAt: "desc" }
    });

    return res.json(stamps);
  } catch (err) {
    console.error("Erro ao listar carimbos", err);
    return res.status(500).json({ message: "Erro ao listar carimbos" });
  }
});

// ADMIN: Delete stamp
router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    // IDOR Protection: Look up the stamp with its work to get tenantId
    const stamp = await prisma.passportStamp.findUnique({
      where: { id },
      include: { work: { select: { tenantId: true } } }
    });
    if (!stamp) return res.status(404).json({ message: "Carimbo não encontrado" });

    // Verify stamp's work belongs to user's tenant (unless MASTER)
    if (user.role !== Role.MASTER && stamp.work?.tenantId !== user.tenantId) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    await prisma.passportStamp.delete({ where: { id } });
    return res.json({ message: "Carimbo excluído com sucesso" });
  } catch (err) {
    console.error("Erro ao excluir carimbo", err);
    return res.status(500).json({ message: "Erro ao excluir carimbo" });
  }
});

export default router;
