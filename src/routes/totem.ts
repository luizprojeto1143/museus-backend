import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role, TotemValidationStatus } from "@prisma/client";
import { z } from "zod";
import crypto from "crypto";
import bcrypt from "bcrypt";

const router = Router();

// Middleware to authenticate device via header "X-Totem-Token"
async function totemDeviceAuth(req: any, res: any, next: any) {
  try {
    const token = req.headers["x-totem-token"];
    if (!token || typeof token !== "string") {
      return res.status(401).json({ message: "Dispositivo não autenticado (Token ausente)" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const device = await prisma.totemDevice.findUnique({
      where: { tokenHash },
      include: { tenant: true }
    });

    if (!device || !device.isActive) {
      return res.status(401).json({ message: "Dispositivo inválido ou inativo" });
    }

    req.totemDevice = device;
    next();
  } catch (error) {
    console.error("Totem Auth Error", error);
    return res.status(500).json({ message: "Erro na autenticação do totem" });
  }
}

// 1. GET /totem/devices (requires auth, tenant admin/master)
router.get("/devices", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req: any, res) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId && req.user!.role !== Role.MASTER) {
      return res.status(400).json({ message: "tenantId não configurado" });
    }

    const devices = await prisma.totemDevice.findMany({
      where: req.user!.role === Role.MASTER ? {} : { tenantId },
      orderBy: { createdAt: "desc" }
    });

    return res.json(devices);
  } catch (error) {
    console.error("Error listing totem devices", error);
    return res.status(500).json({ message: "Erro ao buscar totens" });
  }
});

// 2. POST /totem/devices/register (requires auth, tenant admin)
router.post("/devices/register", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req: any, res) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId && req.user!.role !== Role.MASTER) {
      return res.status(400).json({ message: "tenantId não configurado" });
    }

    const data = z.object({
      name: z.string(),
      pin: z.string().min(4).max(8),
      config: z.any().optional()
    }).parse(req.body);

    const targetTenantId = req.user!.role === Role.MASTER ? (req.body.tenantId || tenantId) : tenantId;
    if (!targetTenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }

    // Generate single-exposure token
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    
    // Hash PIN code
    const pinHash = await bcrypt.hash(data.pin, 10);

    const device = await prisma.totemDevice.create({
      data: {
        name: data.name,
        tokenHash,
        pinHash,
        tenantId: targetTenantId,
        config: data.config || {}
      }
    });

    return res.status(201).json({
      deviceId: device.id,
      deviceToken: token, // Single exposure!
      message: "Dispositivo registrado com sucesso. Guarde o token pois ele não será exibido novamente."
    });
  } catch (error: any) {
    console.error("Error registering totem device", error);
    return res.status(400).json({ message: error.message || "Erro ao registrar totem" });
  }
});

// 3. GET /totem/devices/:id/config (device token authentication)
router.get("/devices/:id/config", totemDeviceAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const device = req.totemDevice;

    if (device.id !== id) {
      return res.status(403).json({ message: "Sem permissão para este totem" });
    }

    return res.json({
      id: device.id,
      name: device.name,
      tenantId: device.tenantId,
      hasPin: !!device.pinHash,
      config: device.config || {}
    });
  } catch (error) {
    console.error("Error fetching totem config", error);
    return res.status(500).json({ message: "Erro ao buscar config do totem" });
  }
});

// 4. POST /totem/devices/:id/verify-pin (device token authentication)
router.post("/devices/:id/verify-pin", totemDeviceAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const device = req.totemDevice;

    if (device.id !== id) {
      return res.status(403).json({ message: "Sem permissão para este totem" });
    }

    const { pin } = z.object({ pin: z.string() }).parse(req.body);
    if (!device.pinHash) {
      return res.status(400).json({ message: "Nenhum PIN cadastrado para este totem" });
    }

    const valid = await bcrypt.compare(pin, device.pinHash);
    return res.json({ valid });
  } catch (error: any) {
    console.error("Error verifying pin", error);
    return res.status(400).json({ message: error.message || "Erro ao verificar PIN" });
  }
});

// 5. POST /totem/devices/:id/deactivate (requires auth, tenant admin)
router.post("/devices/:id/deactivate", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req: any, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;

    const device = await prisma.totemDevice.findFirst({
      where: req.user!.role === Role.MASTER ? { id } : { id, tenantId }
    });

    if (!device) {
      return res.status(404).json({ message: "Dispositivo não encontrado" });
    }

    const updated = await prisma.totemDevice.update({
      where: { id },
      data: { isActive: false }
    });

    return res.json({ success: true, message: "Totem desativado com sucesso", device: updated });
  } catch (error) {
    console.error("Error deactivating totem device", error);
    return res.status(500).json({ message: "Erro ao desativar totem" });
  }
});

// Helper validation logic to do actual ticket check-in and update
async function validateTicketCode(ticketCode: string, device: any, clientValidationId?: string, wasOffline = false): Promise<{ status: TotemValidationStatus; message: string; ticketId?: string }> {
  // Check for idempotency first
  if (clientValidationId) {
    const existing = await prisma.totemValidationLog.findUnique({
      where: { clientValidationId }
    });
    if (existing) {
      return {
        status: existing.status,
        message: existing.message || "Validação duplicada (idempotência)",
        ticketId: existing.ticketId || undefined
      };
    }
  }

  // Find ticket registration
  const reg = await prisma.registration.findUnique({
    where: { code: ticketCode },
    include: {
      event: true
    }
  });

  if (!reg) {
    return { status: "INVALID", message: "Ingresso inválido ou inexistente." };
  }

  // Ensure it matches totem device's tenant
  if (reg.event.tenantId !== device.tenantId) {
    return { status: "INVALID", message: "Ingresso pertence a outro museu." };
  }

  // Validate status
  if (reg.status !== "CONFIRMED" && reg.status !== "CHECKED_IN") {
    return { status: "INVALID", message: `Status inválido para entrada (${reg.status})` };
  }

  if (reg.checkInDate || reg.status === "CHECKED_IN") {
    return { status: "USED", message: "Ingresso já utilizado." };
  }

  // Cooldown validation check (just in case)
  const XP_AMOUNT = 50;

  try {
    // Perform check-in inside atomic transaction
    await prisma.$transaction(async (tx) => {
      await tx.registration.update({
        where: { id: reg.id },
        data: {
          status: "CHECKED_IN",
          checkInDate: new Date()
        }
      });

      if (reg.visitorId) {
        await tx.visitor.update({
          where: { id: reg.visitorId },
          data: { xp: { increment: XP_AMOUNT } }
        });
      }
    });

    return { status: wasOffline ? "SYNCED" : "VALID", message: "Entrada Liberada!", ticketId: reg.id };
  } catch (err: any) {
    return { status: "INVALID", message: err.message || "Erro na validação do ingresso." };
  }
}

// 6. POST /totem/validations (device token authentication)
router.post("/validations", totemDeviceAuth, async (req: any, res) => {
  try {
    const device = req.totemDevice;
    const { ticketCode, clientValidationId } = z.object({
      ticketCode: z.string(),
      clientValidationId: z.string().optional()
    }).parse(req.body);

    const validation = await validateTicketCode(ticketCode, device, clientValidationId, false);

    // Save validation log to database
    await prisma.totemValidationLog.create({
      data: {
        clientValidationId,
        deviceId: device.id,
        ticketId: validation.ticketId || null,
        ticketCode,
        status: validation.status,
        message: validation.message,
        wasOffline: false
      }
    });

    return res.json({
      success: validation.status === "VALID" || validation.status === "SYNCED",
      status: validation.status,
      message: validation.message
    });
  } catch (error: any) {
    console.error("Error validating totem ticket", error);
    return res.status(400).json({ message: error.message || "Erro ao processar validação" });
  }
});

// 7. POST /totem/offline-sync (device token authentication)
router.post("/offline-sync", totemDeviceAuth, async (req: any, res) => {
  try {
    const device = req.totemDevice;
    const { logs } = z.object({
      logs: z.array(z.object({
        clientValidationId: z.string(),
        ticketCode: z.string(),
        validatedAt: z.string()
      }))
    }).parse(req.body);

    const results = [];

    for (const log of logs) {
      const validation = await validateTicketCode(log.ticketCode, device, log.clientValidationId, true);

      // Create validation log
      await prisma.totemValidationLog.upsert({
        where: { clientValidationId: log.clientValidationId },
        update: {},
        create: {
          clientValidationId: log.clientValidationId,
          deviceId: device.id,
          ticketId: validation.ticketId || null,
          ticketCode: log.ticketCode,
          status: validation.status,
          message: validation.message,
          wasOffline: true,
          validatedAt: new Date(log.validatedAt),
          syncedAt: new Date()
        }
      });

      results.push({
        clientValidationId: log.clientValidationId,
        status: validation.status,
        message: validation.message
      });
    }

    return res.json({ success: true, results });
  } catch (error: any) {
    console.error("Error syncing offline totem logs", error);
    return res.status(400).json({ message: error.message || "Erro ao processar sincronismo" });
  }
});

export default router;
