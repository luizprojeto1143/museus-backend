import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// MASTER: Create a new base character
router.post("/", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    const { name, description, imageUrl, tenantId, active } = req.body;
    
    if (!name || !imageUrl) {
      return res.status(400).json({ message: "Nome e imagem são obrigatórios" });
    }

    const character = await prisma.characterBase.create({
      data: {
        name,
        description,
        imageUrl,
        tenantId: tenantId || null,
        active: active !== undefined ? active : true
      }
    });

    res.status(201).json(character);
  } catch (err) {
    console.error("Erro ao criar personagem base:", err);
    res.status(500).json({ message: "Erro ao criar personagem base" });
  }
});

// GET: List available base characters (global + tenant specific)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const isMaster = req.user?.role === Role.MASTER;
    const tenantId = req.user?.tenantId;
    
    const characters = await prisma.characterBase.findMany({
      where: isMaster ? {} : {
        active: true,
        OR: [
          { tenantId: null },
          ...(tenantId ? [{ tenantId }] : [])
        ]
      },
      orderBy: { createdAt: "asc" }
    });

    res.json(characters);
  } catch (err) {
    console.error("Erro ao listar personagens base:", err);
    res.status(500).json({ message: "Erro ao listar personagens base" });
  }
});

// MASTER: Update a base character
router.put("/:id", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, imageUrl, tenantId, active } = req.body;

    const character = await prisma.characterBase.update({
      where: { id },
      data: {
        name,
        description,
        imageUrl,
        tenantId: tenantId || null,
        active: active !== undefined ? active : true
      }
    });

    res.json(character);
  } catch (err) {
    console.error("Erro ao atualizar personagem base:", err);
    res.status(500).json({ message: "Erro ao atualizar personagem base" });
  }
});

// MASTER: Delete a base character
router.delete("/:id", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    
    await prisma.characterBase.delete({
      where: { id }
    });

    res.status(204).send();
  } catch (err) {
    console.error("Erro ao excluir personagem base:", err);
    res.status(500).json({ message: "Erro ao excluir personagem base" });
  }
});

export default router;
