import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { z } from "zod";
import { limiter } from "../middleware/rateLimiter.js";
import { createAuditLog } from "./audit.js";

const router = Router();

/**
 * Public discovery routes
 */

// List all cultural equipments (un-authenticated)
router.get("/public", async (req, res) => {
  try {
    const { tenantId, tipo, search } = req.query;

    const where: any = { ativo: true };
    if (tenantId) where.tenantId = String(tenantId);
    if (tipo) where.tipo = String(tipo);
    if (search) {
      where.OR = [
        { nome: { contains: String(search), mode: 'insensitive' } },
        { descricao: { contains: String(search), mode: 'insensitive' } }
      ];
    }

    const equipments = await prisma.equipamentoCultural.findMany({
      where,
      include: {
        tenant: {
          select: { parentId: true }
        }
      },
      orderBy: { nome: 'asc' }
    });

    // Flatten for easier frontend consumption
    const flattened = equipments.map(e => ({
      ...e,
      cityId: e.tenant?.parentId || null,
      tenant: undefined
    }));

    return res.json(flattened);
  } catch (err) {
    console.error("Erro ao listar equipamentos públicos:", err);
    return res.status(500).json({ message: "Erro ao listar equipamentos" });
  }
});

// Get equipment details by slug or ID
router.get("/public/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    
    const equipment = await prisma.equipamentoCultural.findFirst({
      where: {
        OR: [
          { id: identifier },
          { slug: identifier }
        ],
        ativo: true
      },
      include: {
        tenant: {
          select: {
            name: true,
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
            theme: true,
            historicalFont: true,
            parentId: true
          }
        }
      }
    });

    if (!equipment) {
      return res.status(404).json({ message: "Equipamento não encontrado" });
    }

    const flattened = {
      ...equipment,
      cityId: equipment.tenant?.parentId || null,
      tenant: equipment.tenant // Keep tenant for styles/meta
    };

    return res.json(flattened);
  } catch (err) {
    console.error("Erro ao buscar detalhes do equipamento:", err);
    return res.status(500).json({ message: "Erro interno" });
  }
});

/**
 * Check-in flow
 */
router.post("/:id/checkin", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params; // equipamentoId
    const { method, lat, lng } = req.body;
    const user = req.user!;

    if (user.role !== Role.VISITOR) {
      return res.status(403).json({ message: "Apenas visitantes podem fazer check-in" });
    }

    // Check if visitor entry exists
    const visitor = await prisma.visitor.findUnique({
      where: { id: user.id }
    });

    if (!visitor) {
      return res.status(404).json({ message: "Perfil de visitante não encontrado" });
    }

    // Verify equipment existence
    const equipment = await prisma.equipamentoCultural.findUnique({
      where: { id }
    });

    if (!equipment) {
      return res.status(404).json({ message: "Equipamento não encontrado" });
    }

    // L5 Fix: Prevent XP duplication (Check if already checked in today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingCheckin = await prisma.equipamentoCheckin.findFirst({
      where: {
        visitorId: visitor.id,
        equipamentoId: id,
        createdAt: { gte: today }
      }
    });

    if (existingCheckin) {
      return res.status(200).json({
        message: "Você já realizou o check-in hoje!",
        checkin: existingCheckin,
        xpGained: 0
      });
    }

    // Create check-in record
    const checkin = await prisma.equipamentoCheckin.create({
      data: {
        equipamentoId: id,
        visitorId: visitor.id,
        method: method || 'manual',
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null,
        xpGanho: 20 // Default XP for check-in
      }
    });

    // Update visitor XP
    await prisma.visitor.update({
      where: { id: visitor.id },
      data: { xp: { increment: 20 } }
    });

    return res.status(201).json({
      message: "Check-in realizado com sucesso!",
      checkin,
      xpGained: 20
    });
  } catch (err) {
    console.error("Erro no check-in:", err);
    return res.status(500).json({ message: "Erro ao realizar check-in" });
  }
});

/**
 * Management routes (ADMIN / MASTER)
 */

const equipmentSchema = z.object({
  nome: z.string().min(1),
  slug: z.string().min(1),
  tipo: z.string(),
  descricao: z.string().optional(),
  missao: z.string().optional(),
  endereco: z.string(),
  cidade: z.string(),
  estado: z.string().default("MG"),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  fotoCapaUrl: z.string().optional(),
  logoUrl: z.string().optional(),
  corPrimaria: z.string().optional(),
  ativo: z.boolean().default(true)
});

// List all for management
router.get("/", authMiddleware, requireRole([Role.MASTER, Role.ADMIN, Role.COLLABORATOR]), async (req, res) => {
  try {
    const user = req.user!;
    const where: any = {};

    if (user.role !== Role.MASTER) {
      where.tenantId = user.tenantId;
    }

    const equipments = await prisma.equipamentoCultural.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    return res.json(equipments);
  } catch (err) {
    console.error("Erro ao listar equipamentos para gestão:", err);
    return res.status(500).json({ message: "Erro interno" });
  }
});

// Create new equipment
router.post("/", authMiddleware, requireRole([Role.MASTER, Role.ADMIN, Role.COLLABORATOR]), async (req, res) => {
  try {
    const user = req.user!;
    const data = equipmentSchema.parse(req.body);

    const tenantId = user.role !== Role.MASTER ? user.tenantId : req.body.tenantId;
    if (!tenantId) {
      return res.status(400).json({ message: "Tenant ID é necessário" });
    }

    const equipment = await prisma.equipamentoCultural.create({
      data: {
        ...data,
        tenantId
      }
    });

    await createAuditLog('CREATE', 'EquipamentoCultural', equipment.id, user.id, user.email, tenantId, null, equipment, req);

    return res.status(201).json(equipment);
  } catch (err) {
    console.error("Erro ao criar equipamento:", err);
    if (err instanceof z.ZodError) return res.status(400).json({ errors: err.errors });
    return res.status(500).json({ message: "Erro ao criar equipamento" });
  }
});

// Update equipment
router.put("/:id", authMiddleware, requireRole([Role.MASTER, Role.ADMIN, Role.COLLABORATOR]), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const data = equipmentSchema.partial().parse(req.body);

    const existing = await prisma.equipamentoCultural.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Equipamento não encontrado" });

    if (user.role !== Role.MASTER && existing.tenantId !== user.tenantId) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const equipment = await prisma.equipamentoCultural.update({
      where: { id },
      data
    });

    await createAuditLog('UPDATE', 'EquipamentoCultural', equipment.id, user.id, user.email, equipment.tenantId, existing, equipment, req);

    return res.json(equipment);
  } catch (err) {
    console.error("Erro ao atualizar equipamento:", err);
    return res.status(500).json({ message: "Erro interno" });
  }
});

export default router;
