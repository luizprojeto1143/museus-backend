import { Router } from "express";
import { prisma } from "../prisma.js";
import { mailService } from "../services/email.js";

const router = Router();

/**
 * ASAAS Webhook - Handles payment confirmations
 */
router.post("/asaas", async (req, res) => {
  const { event, payment } = req.body;

  console.log(`[Webhook Asaas] Event: ${event}, Payment ID: ${payment?.id}, Ref: ${payment?.externalReference}`);

  // We only care about PAYMENT_RECEIVED or PAYMENT_CONFIRMED
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

        // Send confirmation email
        const eventTitle = registration.event.title;
        const eventDate = registration.event.startDate ? new Date(registration.event.startDate).toLocaleDateString('pt-BR', {
            weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
        }) : undefined;
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
      // Return 200 to Asaas anyway to avoid retries if it's a code error, 
      // but in production you might want 500 if it's a temp DB issue.
    }
  }

  return res.status(200).send();
});

export default router;
