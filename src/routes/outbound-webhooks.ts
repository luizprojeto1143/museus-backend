import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { prisma } from "../prisma.js";
import { deliverTenantWebhooks, generateWebhookSecret, hashWebhookSecret } from "../services/outboundWebhook.service.js";
import { sendOk } from "../utils/apiResponse.js";

const router = Router();

const ALLOWED_EVENTS = [
  "ticket.confirmed",
  "ticket.checked_in",
  "membership.activated",
  "sponsorship.activated",
  "project.approved",
  "accessibility.completed",
  "donation.completed",
  "system.test"
];

const createSchema = z.object({
  tenantId: z.string().optional(),
  name: z.string().min(2),
  url: z.string().url(),
  events: z.array(z.enum(ALLOWED_EVENTS as [string, ...string[]])).min(1)
});

const updateSchema = createSchema.partial().extend({
  active: z.boolean().optional()
});

function resolveTenantId(req: any) {
  if (req.user.role === "MASTER") {
    return (req.body?.tenantId || req.query?.tenantId) as string | undefined;
  }
  return req.user.tenantId as string | undefined;
}

router.use(authMiddleware, requireRole(["ADMIN", "MASTER"]));

router.get("/", async (req, res) => {
  const tenantId = resolveTenantId(req);
  if (!tenantId) return res.status(400).json({ message: "tenantId obrigatorio" });

  const subscriptions = await prisma.webhookSubscription.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      tenantId: true,
      name: true,
      url: true,
      events: true,
      active: true,
      lastStatusCode: true,
      lastError: true,
      lastDeliveredAt: true,
      createdAt: true,
      updatedAt: true
    }
  });

  return sendOk(res, subscriptions, { allowedEvents: ALLOWED_EVENTS });
});

router.post("/", async (req, res) => {
  const parsed = createSchema.parse(req.body);
  const tenantId = resolveTenantId(req);
  if (!tenantId) return res.status(400).json({ message: "tenantId obrigatorio" });

  const secret = generateWebhookSecret();
  const subscription = await prisma.webhookSubscription.create({
    data: {
      tenantId,
      name: parsed.name,
      url: parsed.url,
      events: parsed.events,
      secretHash: hashWebhookSecret(secret)
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      url: true,
      events: true,
      active: true,
      createdAt: true
    }
  });

  return res.status(201).json({
    success: true,
    data: {
      ...subscription,
      signingSecret: secret
    },
    meta: {
      warning: "O signingSecret e exibido apenas uma vez. Salve-o no sistema integrador."
    }
  });
});

router.patch("/:id", async (req, res) => {
  const tenantId = resolveTenantId(req);
  if (!tenantId) return res.status(400).json({ message: "tenantId obrigatorio" });

  const parsed = updateSchema.parse(req.body);
  const existing = await prisma.webhookSubscription.findFirst({
    where: { id: req.params.id, tenantId }
  });
  if (!existing) return res.status(404).json({ message: "Webhook nao encontrado" });

  const updated = await prisma.webhookSubscription.update({
    where: { id: existing.id },
    data: {
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.url !== undefined ? { url: parsed.url } : {}),
      ...(parsed.events !== undefined ? { events: parsed.events } : {}),
      ...(parsed.active !== undefined ? { active: parsed.active } : {})
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      url: true,
      events: true,
      active: true,
      lastStatusCode: true,
      lastError: true,
      lastDeliveredAt: true,
      updatedAt: true
    }
  });

  return sendOk(res, updated);
});

router.delete("/:id", async (req, res) => {
  const tenantId = resolveTenantId(req);
  if (!tenantId) return res.status(400).json({ message: "tenantId obrigatorio" });

  const existing = await prisma.webhookSubscription.findFirst({
    where: { id: req.params.id, tenantId }
  });
  if (!existing) return res.status(404).json({ message: "Webhook nao encontrado" });

  await prisma.webhookSubscription.update({
    where: { id: existing.id },
    data: { active: false }
  });

  return res.status(204).send();
});

router.post("/:id/test", async (req, res) => {
  const tenantId = resolveTenantId(req);
  if (!tenantId) return res.status(400).json({ message: "tenantId obrigatorio" });

  const existing = await prisma.webhookSubscription.findFirst({
    where: { id: req.params.id, tenantId }
  });
  if (!existing) return res.status(404).json({ message: "Webhook nao encontrado" });

  const results = await deliverTenantWebhooks(tenantId, "system.test", {
    subscriptionId: existing.id,
    message: "Teste de webhook Cultura Viva"
  }, { subscriptionId: existing.id });

  return sendOk(res, results);
});

export default router;
