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
  } catch (err) {
    console.error(`[Stripe Webhook] Idempotency check failed:`, err);
  }

  console.log(`[Stripe Webhook] Received event: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;
        const metadata = session.metadata || {};

        // Recupera o ID de cobrança (charge) real a partir do PaymentIntent no Stripe
        const paymentIntentId = session.payment_intent as string | undefined;
        let realChargeId: string | undefined;

        if (paymentIntentId) {
          try {
            const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
            if (pi.latest_charge) {
              realChargeId = typeof pi.latest_charge === 'string'
                ? pi.latest_charge
                : pi.latest_charge.id;
            }
          } catch (e) {
            console.error(`[Stripe Webhook] Failed to retrieve PaymentIntent ${paymentIntentId}:`, e);
          }
        }
        const stripeChargeId = realChargeId ?? paymentIntentId;

        // 1. Handle Registration (Tickets)
        const registration = await prisma.registration.findFirst({
          where: { stripeCheckoutSessionId: session.id },
          include: { event: true }
        });
        if (registration && registration.status === "PENDING") {
          const amount = Number(registration.pricePaid);
          const fee = Number(registration.platformFee || 0);

          let finTxId: string | undefined;
          if (registration.event?.tenantId) {
            const finTx = await prisma.financialTransaction.create({
              data: {
                tenantId: registration.event.tenantId,
                type: "PAYMENT",
                source: "REGISTRATION",
                amount,
                fee,
                netAmount: amount - fee,
                status: "COMPLETED",
                paymentMethod: "CREDIT_CARD",
                stripePaymentIntentId: paymentIntentId,
                stripeChargeId: stripeChargeId
              }
            });
            finTxId = finTx.id;
          }

          // Confirmar registro + incrementar sold atomicamente
          await prisma.$transaction([
            prisma.registration.update({
              where: { id: registration.id },
              data: { status: "CONFIRMED", financialTransactionId: finTxId }
            }),
            // Incrementa sold apenas agora, após pagamento confirmado
            prisma.ticket.update({
              where: { id: registration.ticketId, sold: { lt: prisma.ticket.fields.quantity } },
              data: { sold: { increment: 1 } }
            })
          ]);
          console.log(`[Webhook] Registration ${registration.code} CONFIRMED + sold incrementado!`);
          
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
          where: { stripeCheckoutSessionId: session.id }
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
              stripePaymentIntentId: paymentIntentId,
              stripeChargeId: stripeChargeId
            }
          });

          await prisma.order.update({
            where: { id: order.id },
            data: { status: "PAID", financialTransactionId: finTx.id }
          });
          console.log(`[Webhook] Order ${order.id} PAID!`);
        }

        // 3. Handle Service Transactions (Chat)
        // Transaction usa stripeCheckoutSessionId (checkout session ID) para lookup
        // e session.payment_intent para salvar o stripePaymentIntentId real
        const transaction = await prisma.transaction.findFirst({
          where: { stripePaymentIntentId: paymentIntentId ?? session.id },
          include: { conversation: { include: { accessibilityProvider: true } } }
        });
        if (transaction && transaction.status === "PENDING") {
          const amount = Number(transaction.amount);
          // Taxa dinâmica do provider, fallback 10%
          const fee = Number(amount * 0.1);

          let finTxId: string | undefined;
          const tenantId = transaction.conversation.accessibilityProvider.tenantId;
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
                stripePaymentIntentId: paymentIntentId,
                stripeChargeId: stripeChargeId
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
          where: { stripePaymentIntentId: paymentIntentId ?? session.id }
        });
        if (execution && execution.status !== "PAID") {
          const amount = Number(execution.approvedBudget || 0);
          const fee = Number(amount * 0.1);
          const tenantId = execution.tenantId;

          let finTxId: string | undefined;
          if (tenantId) {
            const finTx = await prisma.financialTransaction.create({
              data: {
                tenantId,
                type: "PAYMENT",
                source: "SERVICE",
                amount, fee, netAmount: amount - fee,
                status: "COMPLETED", paymentMethod: "CREDIT_CARD",
                stripePaymentIntentId: paymentIntentId,
                stripeChargeId: stripeChargeId
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
          where: { stripeCheckoutSessionId: session.id }
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
              stripePaymentIntentId: paymentIntentId,
              stripeChargeId: stripeChargeId
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

      // Salva chargeback no banco para consulta em /financial/chargebacks
      case "charge.dispute.created":
      case "charge.dispute.updated": {
        const dispute = event.data.object as any;
        const chargeId = dispute.charge as string;

        // Tenta encontrar o tenant pelo charge
        const finTx = await prisma.financialTransaction.findFirst({
          where: { stripeChargeId: chargeId }
        });
        if (!finTx) {
          console.warn(`[Webhook] Dispute ${dispute.id} sem FinancialTransaction correspondente (chargeId=${chargeId})`);
          break;
        }

        await prisma.chargeback.upsert({
          where: { stripeDisputeId: dispute.id },
          create: {
            tenantId:             finTx.tenantId,
            stripeDisputeId:      dispute.id,
            stripeChargeId:       chargeId,
            stripePaymentIntentId: dispute.payment_intent as string | undefined,
            amount:               dispute.amount / 100,
            currency:             (dispute.currency as string).toUpperCase(),
            reason:               dispute.reason,
            status:               dispute.status,
            dueBy:                dispute.evidence_details?.due_by
                                    ? new Date(dispute.evidence_details.due_by * 1000)
                                    : null,
            hasEvidence:          dispute.evidence_details?.has_evidence ?? false
          },
          update: {
            status:      dispute.status,
            hasEvidence: dispute.evidence_details?.has_evidence ?? false,
            dueBy:       dispute.evidence_details?.due_by
                           ? new Date(dispute.evidence_details.due_by * 1000)
                           : null
          }
        });
        console.log(`[Webhook] Chargeback ${dispute.id} salvo no banco (status=${dispute.status})`);
        break;
      }
    }

    // Marca o evento como processado no banco apenas em caso de sucesso
    await prisma.stripeWebhookEvent.create({
      data: {
        id: event.id,
        type: event.type
      }
    });
  } catch (err) {
    console.error(`[Stripe Webhook Processing Error]:`, err);
    return res.status(500).send("Internal Server Error");
  }

  return res.status(200).send({ received: true });
});

export default router;
