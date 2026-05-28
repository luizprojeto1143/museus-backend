import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { mailService } from "../services/email.js";
import { stripeService, stripe } from "../../services/stripeService.js";

const router = Router();

/**
 * Stripe Webhook - Handles real-time payment events
 * IMPORTANT: Requires raw body for signature verification
 */
router.post("/stripe", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // In express, req.body is usually parsed. For webhooks, we need the raw body.
    // If you are using express.json({ verify: ... }), it might work.
    event = stripe.webhooks.constructEvent(
      (req as any).rawBody || JSON.stringify(req.body),
      sig as string,
      endpointSecret as string
    );
  } catch (err: any) {
    console.error(`[Stripe Webhook] Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[Stripe Webhook] Received event: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;
        const metadata = session.metadata || {};

        // 1. Handle Registration (Tickets)
        const registration = await prisma.registration.findFirst({
          where: { stripePaymentIntentId: session.id }
        });
        if (registration && registration.status === "PENDING") {
          await prisma.registration.update({
            where: { id: registration.id },
            data: { status: "CONFIRMED" }
          });
          console.log(`[Webhook] Registration ${registration.code} CONFIRMED!`);
          
          // Send Ticket Email
          const eventData = await prisma.event.findUnique({ where: { id: registration.eventId } });
          mailService.sendTicketEmail(
            registration.guestEmail,
            eventData?.title || "Evento",
            registration.guestName,
            registration.code
          );
        }

        // 2. Handle Shop Orders
        const order = await prisma.order.findFirst({
          where: { stripePaymentIntentId: session.id }
        });
        if (order && order.status === "PENDING") {
          await prisma.order.update({
            where: { id: order.id },
            data: { status: "PAID" }
          });
          console.log(`[Webhook] Order ${order.id} PAID!`);
        }

        // 3. Handle Service Transactions (Chat)
        const transaction = await prisma.transaction.findFirst({
          where: { stripePaymentIntentId: session.id }
        });
        if (transaction && transaction.status === "PENDING") {
          await prisma.transaction.update({
            where: { id: transaction.id },
            data: { status: "PAID", paidAt: new Date() }
          });
          console.log(`[Webhook] Service Transaction ${transaction.id} PAID!`);
        }

        // 4. Handle Accessibility Service Executions
        const execution = await prisma.accessibilityExecution.findFirst({
          where: { stripePaymentIntentId: session.id }
        });
        if (execution && execution.status !== "PAID") {
          await prisma.accessibilityExecution.update({
            where: { id: execution.id },
            data: { status: "PAID" }
          });
          console.log(`[Webhook] Accessibility Execution ${execution.id} PAID!`);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as any;
        const customerId = subscription.customer as string;
        const status = subscription.status; // active, past_due, canceled, etc.

        // Update Provider Subscription Status
        const provider = await prisma.accessibilityProvider.findFirst({
          where: { stripeCustomerId: customerId }
        });

        if (provider) {
          await prisma.accessibilityProvider.update({
            where: { id: provider.id },
            data: { 
              subscriptionStatus: status.toUpperCase(),
              active: status === "active"
            }
          });
          console.log(`[Webhook] Provider ${provider.name} subscription status: ${status}`);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as any;
        const customerId = subscription.customer as string;

        const provider = await prisma.accessibilityProvider.findFirst({
          where: { stripeCustomerId: customerId }
        });

        if (provider) {
          await prisma.accessibilityProvider.update({
            where: { id: provider.id },
            data: { 
              subscriptionStatus: "CANCELED",
              active: false
            }
          });
          console.log(`[Webhook] Provider ${provider.name} subscription CANCELED.`);
        }
        break;
      }

      /*
      case "donation.succeeded": {
        // @ts-ignore
        const session = event.data.object as any;
        const donation = await prisma.donation.findFirst({
            where: { stripePaymentIntentId: session.id }
        });
        if (donation && donation.status === "PENDING") {
            await prisma.donation.update({
                where: { id: donation.id },
                data: { status: "COMPLETED" }
            });
            console.log(`[Webhook] Donation ${donation.id} COMPLETED!`);
        }
        break;
      }
      */
    }
  } catch (err) {
    console.error(`[Stripe Webhook Processing Error]:`, err);
    return res.status(500).send("Internal Server Error");
  }

  return res.status(200).send({ received: true });
});

export default router;
