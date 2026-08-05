import crypto from "crypto";
import axios from "axios";
import { prisma } from "../prisma.js";

const WEBHOOK_TIMEOUT_MS = Number(process.env.OUTBOUND_WEBHOOK_TIMEOUT_MS || 10000);

export function generateWebhookSecret() {
  return `whsec_${crypto.randomBytes(32).toString("hex")}`;
}

export function hashWebhookSecret(secret: string) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export function signWebhookPayload(secretHash: string, timestamp: string, body: string) {
  return crypto
    .createHmac("sha256", secretHash)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

type DeliveryOptions = {
  subscriptionId?: string;
};

export async function deliverTenantWebhooks(
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>,
  options: DeliveryOptions = {}
) {
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: {
      tenantId,
      ...(options.subscriptionId ? { id: options.subscriptionId } : {}),
      active: true,
      events: { has: eventType }
    }
  });

  const body = JSON.stringify({
    id: crypto.randomUUID(),
    type: eventType,
    tenantId,
    createdAt: new Date().toISOString(),
    data: payload
  });

  const results = [];

  for (const subscription of subscriptions) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signWebhookPayload(subscription.secretHash, timestamp, body);

    try {
      const response = await axios.post(subscription.url, body, {
        timeout: WEBHOOK_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "CulturaViva-Webhooks/1.0",
          "X-Cultura-Event": eventType,
          "X-Cultura-Timestamp": timestamp,
          "X-Cultura-Signature": `t=${timestamp},v1=${signature}`
        },
        validateStatus: status => status >= 200 && status < 500
      });

      await prisma.webhookSubscription.update({
        where: { id: subscription.id },
        data: {
          lastStatusCode: response.status,
          lastError: response.status >= 400 ? `HTTP ${response.status}` : null,
          lastDeliveredAt: new Date()
        }
      });

      results.push({ id: subscription.id, ok: response.status < 400, statusCode: response.status });
    } catch (error: any) {
      await prisma.webhookSubscription.update({
        where: { id: subscription.id },
        data: {
          lastError: error?.message || "Delivery failed",
          lastDeliveredAt: new Date()
        }
      });
      results.push({ id: subscription.id, ok: false, error: error?.message || "Delivery failed" });
    }
  }

  return results;
}
