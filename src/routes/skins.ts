import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware as authenticate, requireRole as authorize } from "../middleware/auth.js";

const router = Router();

// Master only: CRUD skins
router.get("/", authenticate, authorize(["MASTER"]), async (req, res) => {
  const skins = await prisma.skin.findMany({
    include: { _count: { select: { owners: true } } }
  });
  res.json(skins);
});

router.post("/", authenticate, authorize(["MASTER"]), async (req, res) => {
  const skin = await prisma.skin.create({ data: req.body });
  res.json(skin);
});

router.put("/:id", authenticate, authorize(["MASTER"]), async (req, res) => {
  const skin = await prisma.skin.update({
    where: { id: req.params.id },
    data: req.body
  });
  res.json(skin);
});

router.delete("/:id", authenticate, authorize(["MASTER"]), async (req, res) => {
  await prisma.skin.delete({ where: { id: req.params.id } });
  res.sendStatus(204);
});

export default router;
