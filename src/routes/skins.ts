import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware as authenticate, requireRole as authorize } from "../middleware/auth.js";
import { generateSkinDescription } from "../services/avatarAI.js";

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
  const { imageUrl } = req.body;
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
      ...req.body,
      aiDescription
    } 
  });
  res.json(skin);
});

router.put("/:id", authenticate, authorize(["MASTER"]), async (req, res) => {
  const { imageUrl } = req.body;
  const oldSkin = await prisma.skin.findUnique({ where: { id: req.params.id } }) as any;
  let aiDescription = oldSkin?.aiDescription;

  // Re-generate description if image changed
  if (imageUrl && imageUrl !== oldSkin?.imageUrl) {
    try {
      aiDescription = await generateSkinDescription(imageUrl);
    } catch (err) {
      console.error("[Skins] AI Description Update Error:", err);
    }
  }

  const skin = await prisma.skin.update({
    where: { id: req.params.id },
    data: {
      ...req.body,
      aiDescription
    }
  });
  res.json(skin);
});

router.delete("/:id", authenticate, authorize(["MASTER"]), async (req, res) => {
  await prisma.skin.delete({ where: { id: req.params.id } });
  res.sendStatus(204);
});

export default router;
