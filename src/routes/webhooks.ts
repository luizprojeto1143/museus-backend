import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { mailService } from "../services/email.js";
import { stripeService, stripe } from "../services/stripeService.js";

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
      req.body,
      sig as string,
      endpointSecret as string
    );
  } catch (err: any) {
    console.error(`[Stripe Webhook] Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotency Check: Prevent duplicate processing of the same Stripe event
  try {
    const existingEvent = await prisma.stripeWebhookEvent.findUnique({
      where: { id: event.id }
    });
    if (existingEvent) {
      console.log(`[Stripe Webhook] Event ${event.id} already processed. Skipping.`);
      return res.status(200).send({ received: true, duplicate: true });
    }
    await prisma.stripeWebhookEvent.create({
      data: {
        id: event.id,
        type: event.type
      }
    });
  } catch (err) {
    console.error(`[Stripe Webhook] Idempotency check failed:`, err);
    // Proceeding even if this fails to avoid blocking payment confirmation, but ideally we return 500
  }

  console.log(`[Stripe Webhook] Received event: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;
        const metadata = session.metadata || {};

        // 1. Handle Registration (Tickets)
        const registration = await prisma.registration.findFirst({
          where: { stripePaymentIntentId: session.id },
          include: { Event: true }
        });
        if (registration && registration.status === "PENDING") {
          const amount = Number(registration.pricePaid);
          const fee = Number(registration.platformFee || 0);

          let finTxId: string | undefined;
          if (registration.Event?.tenantId) {
            const finTx = await prisma.financialTransaction.create({
              data: {
                tenantId: registration.Event.tenantId,
                type: "PAYMENT",
                source: "REGISTRATION",
                amount,
                fee,
                netAmount: amount - fee,
                status: "COMPLETED",
                paymentMethod: "CREDIT_CARD",
                stripePaymentIntentId: session.id,
                stripeChargeId: session.payment_intent as string | undefined
              }
            });
            finTxId = finTx.id;
          }

          await prisma.registration.update({
            where: { id: registration.id },
            data: { status: "CONFIRMED", financialTransactionId: finTxId }
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
          const amount = Number(order.total);
          const fee = Number(order.platformFee || 0);

          const finTx = await prisma.financialTransaction.create({
            data: {
              tenantId: order.tenantId,
              type: "PAYMENT",
              source: "ORDER",
              amount,
              fee,
              netAmount: amount - fee,
              status: "COMPLETED",
              paymentMethod: "CREDIT_CARD",
              stripePaymentIntentId: session.id,
              stripeChargeId: session.payment_intent as string | undefined
            }
          });

          await prisma.order.update({
            where: { id: order.id },
            data: { status: "PAID", financialTransactionId: finTx.id }
          });
          console.log(`[Webhook] Order ${order.id} PAID!`);
        }

        // 3. Handle Service Transactions (Chat)
        const transaction = await prisma.transaction.findFirst({
          where: { stripePaymentIntentId: session.id },
          include: { Conversation: { include: { AccessibilityProvider: true } } }
        });
        if (transaction && transaction.status === "PENDING") {
          const amount = Number(transaction.amount);
          const fee = Number(amount * 0.1); // Assumindo 10% padrão se não houver no schema do provider

          let finTxId: string | undefined;
          const tenantId = transaction.Conversation.AccessibilityProvider.tenantId;
          if (tenantId) {
            const finTx = await prisma.financialTransaction.create({
              data: {
                tenantId,
                type: "PAYMENT",
                source: "SERVICE",
                amount,
                fee,
                netAmount: amount - fee,
                status: "COMPLETED",
                paymentMethod: "CREDIT_CARD",
                stripePaymentIntentId: session.id,
                stripeChargeId: session.payment_intent as string | undefined
              }
            });
            finTxId = finTx.id;
          }

          await prisma.transaction.update({
            where: { id: transaction.id },
            data: { status: "PAID", paidAt: new Date(), financialTransactionId: finTxId }
          });
          console.log(`[Webhook] Service Transaction ${transaction.id} PAID!`);
        }

        // 4. Handle Accessibility Service Executions
        const execution = await prisma.accessibilityExecution.findFirst({
          where: { stripePaymentIntentId: session.id },
          include: { Request: { include: { CulturalProject: true, Event: true } } }
        });
        if (execution && execution.status !== "PAID") {
          const amount = Number(execution.amount);
          const fee = Number(amount * 0.1); // Assumindo 10%
          const tenantId = execution.Request.CulturalProject?.tenantId || execution.Request.Event?.tenantId;

          let finTxId: string | undefined;
          if (tenantId) {
            const finTx = await prisma.financialTransaction.create({
              data: {
                tenantId,
                type: "PAYMENT",
                source: "SERVICE",
                amount, fee, netAmount: amount - fee,
                status: "COMPLETED", paymentMethod: "CREDIT_CARD",
                stripePaymentIntentId: session.id, stripeChargeId: session.payment_intent as string | undefined
              }
            });
            finTxId = finTx.id;
          }

          await prisma.accessibilityExecution.update({
            where: { id: execution.id },
            data: { status: "PAID", financialTransactionId: finTxId }
          });
          console.log(`[Webhook] Accessibility Execution ${execution.id} PAID!`);
        }

        // 5. Handle Donations
        const donation = await prisma.donation.findFirst({
          where: { stripePaymentIntentId: session.id }
        });
        if (donation && donation.status === "PENDING") {
          const amount = Number(donation.amount);
          const fee = Number(donation.platformFee || 0);
          
          const finTx = await prisma.financialTransaction.create({
            data: {
              tenantId: donation.tenantId,
              type: "PAYMENT",
              source: "DONATION",
              amount, fee, netAmount: amount - fee,
              status: "COMPLETED", paymentMethod: "CREDIT_CARD",
              stripePaymentIntentId: session.id, stripeChargeId: session.payment_intent as string | undefined
            }
          });

          await prisma.donation.update({
            where: { id: donation.id },
            data: { status: "COMPLETED", financialTransactionId: finTx.id }
          });
          console.log(`[Webhook] Donation ${donation.id} COMPLETED!`);
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
