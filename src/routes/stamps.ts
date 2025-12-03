import { Router } from "express";
import { prisma } from "../prisma.js";

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

    const existing = await prisma.passportStamp.findFirst({
      where: { visitorId, workId }
    });

    if (existing) {
      return res.json({ message: "Carimbo já existe", stamp: existing });
    }

    const stamp = await prisma.passportStamp.create({
      data: {
        visitorId,
        workId
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

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.passportStamp.delete({ where: { id } });
    return res.json({ message: "Carimbo excluído com sucesso" });
  } catch (err) {
    console.error("Erro ao excluir carimbo", err);
    return res.status(500).json({ message: "Erro ao excluir carimbo" });
  }
});

export default router;
