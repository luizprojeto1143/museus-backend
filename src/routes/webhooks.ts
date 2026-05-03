import { Router, Request } from "express";
import { prisma } from "../prisma.js";
import { mailService } from "../services/email.js";
import crypto from "crypto";

const router = Router();

/**
 * C8: Verify the Asaas webhook signature.
 * Asaas signs the payload using HMAC-SHA256 with the webhook secret.
 * The signature is sent in the `asaas-access-token` header.
 * Configure ASAAS_WEBHOOK_SECRET in your environment variables.
 */
function verifyAsaasSignature(req: Request): boolean {
  const secret = process.env.ASAAS_WEBHOOK_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[Webhook] ASAAS_WEBHOOK_SECRET is not set. Rejecting all requests.");
      return false;
    }
    // Development: allow through but warn loudly
    console.warn("[Webhook] ASAAS_WEBHOOK_SECRET not set — skipping signature check (dev only).");
    return true;
  }

  const receivedSignature = req.headers["asaas-access-token"] as string | undefined;
  if (!receivedSignature) return false;

  const body = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  try {
    // timingSafeEqual prevents timing-based side-channel attacks
    return crypto.timingSafeEqual(
      Buffer.from(receivedSignature, "utf8"),
      Buffer.from(expectedSignature, "utf8")
    );
  } catch {
    return false;
  }
}

/**
 * ASAAS Webhook - Handles payment confirmations
 */
router.post("/asaas", async (req, res) => {
  // C8: Verify signature before processing any payload
  if (!verifyAsaasSignature(req)) {
    console.warn("[Webhook Asaas] Invalid or missing signature. Request rejected.");
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  const { event, payment } = req.body;

  console.log(`[Webhook Asaas] Event: ${event}, Payment ID: ${payment?.id}, Ref: ${payment?.externalReference}`);

  if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") {
    const code = payment.externalReference;
    if (!code) return res.status(200).send(); // Safe ignore

    try {
      const registration = await prisma.registration.findUnique({
        where: { code },
        include: {
          event: { select: { title: true, startDate: true, location: true } },
          ticket: { select: { name: true } }
        }
      });

      if (registration && registration.status === "PENDING") {
        await prisma.registration.update({
          where: { id: registration.id },
          data: { status: "CONFIRMED" }
        });

        console.log(`[Webhook Asaas] Registration ${code} CONFIRMED!`);

        const eventTitle = registration.event.title;
        const eventDate = registration.event.startDate
          ? new Date(registration.event.startDate).toLocaleDateString("pt-BR", {
              weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"
            })
          : undefined;
        const eventLocation = registration.event.location || undefined;

        await mailService.sendTicketEmail(
          registration.guestEmail,
          eventTitle,
          registration.guestName,
          registration.code,
          eventDate,
          eventLocation
        );
      }
    } catch (err) {
      console.error("[Webhook Asaas] Error processing confirmation:", err);
    }
  }

  return res.status(200).send();
});

export default router;
