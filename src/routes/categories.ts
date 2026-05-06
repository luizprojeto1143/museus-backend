import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// Listar categorias
router.get("/", async (req, res) => {
  try {
    const { tenantId } = req.query;
    if (!tenantId) return res.status(400).json({ error: "Missing tenantId" });

    const categories = await prisma.category.findMany({
      where: { tenantId: String(tenantId) },
      include: {
        _count: {
          select: { works: true, trails: true, events: true }
        }
      },
      orderBy: { name: "asc" }
    });

    if (categories.length === 0) {
      // Check if tenant exists at all to differentiate between "no categories" and "deleted tenant"
      const tenantExists = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
      if (!tenantExists) {
        return res.json([]); // Return empty if tenant is gone, don't crash
      }
    }

    const formatted = categories.map(cat => ({
      ...cat,
      usageCount: cat._count.works + cat._count.trails + cat._count.events
    }));

    res.json(formatted);
  } catch (error) {
    console.error("Error listing categories:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Criar categoria
router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const user = req.user!;
    const { name, type, description } = req.body;

    const tenantId = user.role === Role.MASTER ? (req.body.tenantId as string) : user.tenantId;

    if (!name || !type || !tenantId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const category = await prisma.category.create({
      data: {
        name,
        type,
        description,
        tenantId
      }
    });

    res.json(category);
  } catch (error) {
    console.error("Error creating category:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Obter categoria
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const category = await prisma.category.findUnique({
      where: { id }
    });

    if (!category) return res.status(404).json({ error: "Category not found" });

    res.json(category);
  } catch (error) {
    console.error("Error getting category:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Atualizar categoria
router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const { name, type, description } = req.body;

    // IDOR Protection: Verify resource belongs to user's tenant
    const whereClause = user.role === Role.MASTER
      ? { id }
      : { id, tenantId: user.tenantId as string };
    const existing = await prisma.category.findFirst({ where: whereClause });
    if (!existing) return res.status(404).json({ error: "Category not found" });

    const category = await prisma.category.update({
      where: { id },
      data: { name, type, description }
    });

    res.json(category);
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Atualizar status (patch)
router.patch("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const { active } = req.body;

    // IDOR Protection: Verify resource belongs to user's tenant
    const whereClause = user.role === Role.MASTER
      ? { id }
      : { id, tenantId: user.tenantId as string };
    const existing = await prisma.category.findFirst({ where: whereClause });
    if (!existing) return res.status(404).json({ error: "Category not found" });

    const category = await prisma.category.update({
      where: { id },
      data: { active }
    });

    res.json(category);
  } catch (error) {
    console.error("Error patching category:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Deletar categoria
router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    // IDOR Protection: Verify resource belongs to user's tenant
    const whereClause = user.role === Role.MASTER
      ? { id }
      : { id, tenantId: user.tenantId as string };
    const category = await prisma.category.findFirst({
      where: whereClause,
      include: {
        _count: {
          select: { works: true, trails: true, events: true }
        }
      }
    });

    if (!category) return res.status(404).json({ error: "Category not found" });

    const usage = category._count.works + category._count.trails + category._count.events;
    if (usage > 0) {
      return res.status(400).json({ error: "Cannot delete category in use" });
    }

    await prisma.category.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
