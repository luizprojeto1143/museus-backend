import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// Lista eventos
router.get("/", async (req, res) => {
  try {
    const tenantId = req.query.tenantId as string | undefined;
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }
    const events = await prisma.event.findMany({
      where: { tenantId },
      orderBy: { startDate: "asc" }
    });
    return res.json(events);
  } catch (err) {
    console.error("Erro listar eventos", err);
    return res.status(500).json({ message: "Erro ao listar eventos" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });

    if (!event) {
      return res.status(404).json({ message: "Evento não encontrado" });
    }

    return res.json(event);
  } catch (err) {
    console.error("Erro ao buscar evento", err);
    return res.status(500).json({ message: "Erro ao buscar evento" });
  }
});

// CRUD Admin
router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const user = req.user!;
    const tenantId = user.role === Role.MASTER ? (req.body.tenantId as string) : user.tenantId;
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }

    interface EventBody {
      title: string;
      description?: string;
      location?: string;
      startDate: string;
      endDate?: string;
    }

    const { title, description, location, startDate, endDate } = req.body as EventBody;
    const event = await prisma.event.create({
      data: {
        title,
        description,
        location,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        tenantId
      }
    });
    return res.status(201).json(event);
  } catch (err) {
    console.error("Erro criar evento", err);
    return res.status(500).json({ message: "Erro ao criar evento" });
  }
});

router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, location, startDate, endDate } = req.body as {
      title: string;
      description?: string;
      location?: string;
      startDate: string;
      endDate?: string;
    };
    const event = await prisma.event.update({
      where: { id },
      data: {
        title,
        description,
        location,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null
      }
    });
    return res.json(event);
  } catch (err) {
    console.error("Erro atualizar evento", err);
    return res.status(500).json({ message: "Erro ao atualizar evento" });
  }
});

router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.event.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    console.error("Erro excluir evento", err);
    return res.status(500).json({ message: "Erro ao excluir evento" });
  }
});

export default router;
