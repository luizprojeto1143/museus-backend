import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

router.post("/", authMiddleware, async (req, res) => {
  try {
    const { workId } = req.body as {
      workId?: string;
    };
    const user = req.user!;

    if (!workId) {
      return res.status(400).json({ message: "workId é obrigatório" });
    }

    // Buscar a obra para verificar o tenantId
    const work = await prisma.work.findUnique({ where: { id: workId } });
    if (!work) return res.status(404).json({ message: "Obra não encontrada" });

    // Buscar o visitante do usuário logado correspondente ao tenantId da obra
    const visitor = await prisma.visitor.findFirst({
      where: { email: user.email.toLowerCase(), tenantId: work.tenantId }
    });
    if (!visitor) {
      return res.status(404).json({ message: "Perfil de visitante não encontrado para este museu" });
    }

    const visitorId = visitor.id;

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
