import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware as authenticate, requireRole as authorize } from "../../middleware/auth.js";
import { generateSkinDescription } from "../../services/avatarAI.js";

const router = Router();

// Master only: CRUD skins
router.get("/", authenticate, authorize(["MASTER"]), async (req, res) => {
  const skins = await prisma.skin.findMany({
    include: { 
      _count: { select: { owners: true } },
      characterBase: true
    }
  });
  res.json(skins);
});

router.post("/", authenticate, authorize(["MASTER"]), async (req, res) => {
  try {
    // L3 Fix: Whitelist fields to prevent injection
    const { 
      name, description, imageUrl, xpCost, rarity, 
      tenantId, active, eventOnly, spaceId, characterBaseId 
    } = req.body;

    let aiDescription = null;

    if (imageUrl) {
      try {
        aiDescription = await generateSkinDescription(imageUrl);
      } catch (err) {
        console.error("[Skins] AI Description Error:", err);
      }
    }

    const skin = await prisma.skin.create({ 
      data: { 
        name,
        description,
        imageUrl,
        xpCost: parseInt(xpCost) || 0,
        rarity: rarity || "COMMON",
        tenantId,
        active: active !== undefined ? active : true,
        eventOnly: eventOnly !== undefined ? eventOnly : false,
        spaceId,
        characterBaseId,
        aiDescription
      } 
    });
    res.status(201).json(skin);
  } catch (error) {
    res.status(500).json({ error: "Erro ao criar skin" });
  }
});

router.put("/:id", authenticate, authorize(["MASTER"]), async (req, res) => {
  try {
    const { id } = req.params;
    // L3 Fix: Whitelist fields
    const { 
      name, description, imageUrl, xpCost, rarity, 
      active, eventOnly, spaceId, characterBaseId 
    } = req.body;

    const oldSkin = await prisma.skin.findUnique({ where: { id } });
    if (!oldSkin) return res.status(404).json({ error: "Skin não encontrada" });

    let aiDescription = oldSkin.aiDescription;

    // Re-generate description if image changed
    if (imageUrl && imageUrl !== oldSkin.imageUrl) {
      try {
        aiDescription = await generateSkinDescription(imageUrl);
      } catch (err) {
        console.error("[Skins] AI Description Update Error:", err);
      }
    }

    const skin = await prisma.skin.update({
      where: { id },
      data: {
        name,
        description,
        imageUrl,
        xpCost: xpCost !== undefined ? parseInt(xpCost) : undefined,
        rarity,
        active,
        eventOnly,
        spaceId,
        characterBaseId,
        aiDescription
      }
    });
    res.json(skin);
  } catch (error) {
    res.status(500).json({ error: "Erro ao atualizar skin" });
  }
});

router.delete("/:id", authenticate, authorize(["MASTER"]), async (req, res) => {
  try {
    const { id } = req.params;

    // L4 Fix: Block delete if there are owners
    const ownersCount = await prisma.visitorSkin.count({ where: { skinId: id } });
    
    if (ownersCount > 0) {
      return res.status(400).json({ 
        error: "Não é possível excluir uma skin que já possui donos. Desative-a em vez de excluir.",
        ownersCount 
      });
    }

    await prisma.skin.delete({ where: { id } });
    res.sendStatus(204);
  } catch (error) {
    res.status(500).json({ error: "Erro ao excluir skin" });
  }
});

export default router;
