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
    const tenantId = req.user?.tenantId;
    
    const characters = await prisma.characterBase.findMany({
      where: {
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

export default router;
