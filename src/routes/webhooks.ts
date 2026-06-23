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

  let eventStored = false;
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
        const registrations = await prisma.registration.findMany({
          where: { stripeCheckoutSessionId: session.id },
          include: { event: true }
        });
        const pendingRegistrations = registrations.filter(r => r.status === "PENDING");
        if (pendingRegistrations.length > 0) {
          const firstReg = pendingRegistrations[0];
          const ticketId = firstReg.ticketId;

          // Check for expiration (30 minutes)
          const now = new Date();
          const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
          
          const expiredRegs = pendingRegistrations.filter(r => r.createdAt < thirtyMinutesAgo);
          const validPendingRegistrations = pendingRegistrations.filter(r => r.createdAt >= thirtyMinutesAgo);

          if (expiredRegs.length > 0) {
            await prisma.registration.updateMany({
              where: { id: { in: expiredRegs.map(r => r.id) } },
              data: { status: "CANCELED" }
            });
            console.log(`[Webhook] Marked ${expiredRegs.length} expired registrations as CANCELED.`);
          }

          if (validPendingRegistrations.length > 0) {
            const quantity = validPendingRegistrations.length;
            const totalAmount = validPendingRegistrations.reduce((acc, r) => acc + Number(r.pricePaid), 0);
            const totalFee = validPendingRegistrations.reduce((acc, r) => acc + Number(r.platformFee || 0), 0);

            await prisma.$transaction(async (tx) => {
              const duplicate = await tx.stripeWebhookEvent.findUnique({
                where: { id: event.id }
              });
              if (duplicate) return;

              let finTxId: string | undefined;
              if (firstReg.event?.tenantId) {
                const finTx = await tx.financialTransaction.create({
                  data: {
                    tenantId: firstReg.event.tenantId,
                    type: "PAYMENT",
                    source: "REGISTRATION",
                    amount: totalAmount,
                    fee: totalFee,
                    netAmount: totalAmount - totalFee,
                    status: "COMPLETED",
                    paymentMethod: "CREDIT_CARD",
                    stripePaymentIntentId: paymentIntentId,
                    stripeChargeId: stripeChargeId
                  }
                });
                finTxId = finTx.id;
              }

              // Confirmar registros + incrementar sold atomicamente
              await tx.registration.updateMany({
                where: { id: { in: validPendingRegistrations.map(r => r.id) } },
                data: { status: "CONFIRMED", financialTransactionId: finTxId }
              });
              await tx.ticket.update({
                where: { id: ticketId },
                data: { sold: { increment: quantity } }
              });
              await tx.stripeWebhookEvent.create({
                data: {
                  id: event.id,
                  type: event.type
                }
              });
            });

            eventStored = true;
            console.log(`[Webhook] ${quantity} Registrations CONFIRMED + sold incremented!`);
            
            // Send Ticket Email
            const eventData = await prisma.event.findUnique({ where: { id: firstReg.eventId } });
            for (const reg of validPendingRegistrations) {
              mailService.sendTicketEmail(
                reg.guestEmail,
                eventData?.title || "Evento",
                reg.guestName,
                reg.code
              );
            }
          } else {
            // All registrations were expired. Record the webhook event to avoid unprocessed state
            await prisma.stripeWebhookEvent.create({
              data: {
                id: event.id,
                type: event.type
              }
            });
            eventStored = true;
          }
        }

        // 1.5. Handle Theater Sessions (Seats)
        if (metadata && metadata.type === "THEATER") {
          const eventId = metadata.eventId;
          const seatIds = JSON.parse(metadata.seatIds || "[]") as string[];
          const visitorId = metadata.visitorId || null;
          const tenantId = metadata.tenantId;
          const ticketId = metadata.ticketId || null;

          if (seatIds.length > 0) {
            await prisma.$transaction(async (tx) => {
              const duplicate = await tx.stripeWebhookEvent.findUnique({
                where: { id: event.id }
              });
              if (duplicate) return;

              // Confirm/upsert seats as SOLD
              for (const seatId of seatIds) {
                await tx.theaterSeatReservation.upsert({
                  where: { eventId_seatId: { eventId, seatId } },
                  update: { status: "SOLD", visitorId, ticketId, expiresAt: null },
                  create: { eventId, seatId, status: "SOLD", visitorId, ticketId }
                });
              }

              // Calculate price and fee
              const totalAmount = Number(session.amount_total || 0) / 100;
              
              // Resolve platform fee
              let feeVal = 0;
              if (session.application_fee_amount) {
                feeVal = Number(session.application_fee_amount) / 100;
              } else {
                const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
                const feePercentage = tenant?.feePercentage ?? 10.0;
                feeVal = totalAmount * (feePercentage / 100);
              }

              // Log FinancialTransaction for auditing
              await tx.financialTransaction.create({
                data: {
                  tenantId,
                  type: "PAYMENT",
                  source: "THEATER",
                  amount: totalAmount,
                  fee: feeVal,
                  netAmount: totalAmount - feeVal,
                  status: "COMPLETED",
                  paymentMethod: "CREDIT_CARD",
                  stripePaymentIntentId: paymentIntentId,
                  stripeChargeId: stripeChargeId
                }
              });

              await tx.stripeWebhookEvent.create({
                data: {
                  id: event.id,
                  type: event.type
                }
              });
            });

            eventStored = true;
            console.log(`[Webhook] Theater seats ${seatIds.join(", ")} SOLD!`);
          }
        }

        // 2. Handle Shop Orders
        const order = await prisma.order.findFirst({
          where: { stripeCheckoutSessionId: session.id }
        });
        if (order && order.status === "PENDING") {
          const amount = Number(order.total);
          const fee = Number(order.platformFee || 0);

          await prisma.$transaction(async (tx) => {
            const duplicate = await tx.stripeWebhookEvent.findUnique({ where: { id: event.id } });
            if (duplicate) return;

            const finTx = await tx.financialTransaction.create({
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

            await tx.order.update({
              where: { id: order.id },
              data: { status: "PAID", financialTransactionId: finTx.id }
            });

            await tx.stripeWebhookEvent.create({
              data: {
                id: event.id,
                type: event.type
              }
            });
          });

          eventStored = true;
          console.log(`[Webhook] Order ${order.id} PAID!`);
        }

        // 3. Handle Service Transactions (Chat)
        const transaction = await prisma.transaction.findFirst({
          where: { stripePaymentIntentId: session.id },
          include: { conversation: { include: { accessibilityProvider: true } } }
        });
        if (transaction && transaction.status === "PENDING") {
          const amount = Number(transaction.amount);
          const tenantId = transaction.conversation.accessibilityProvider.tenantId;

          await prisma.$transaction(async (tx) => {
            const duplicate = await tx.stripeWebhookEvent.findUnique({ where: { id: event.id } });
            if (duplicate) return;

            let finTxId: string | undefined;
            if (tenantId) {
              const tenant = await tx.tenant.findUnique({
                where: { id: tenantId },
                select: { feePercentage: true }
              });
              const feeRate = (tenant?.feePercentage ?? 10) / 100;
              const fee = Number(amount * feeRate);

              const finTx = await tx.financialTransaction.create({
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

            await tx.transaction.update({
              where: { id: transaction.id },
              data: { status: "PAID", paidAt: new Date(), financialTransactionId: finTxId }
            });

            await tx.stripeWebhookEvent.create({
              data: {
                id: event.id,
                type: event.type
              }
            });
          });

          eventStored = true;
          console.log(`[Webhook] Service Transaction ${transaction.id} PAID!`);
        }

        // 4. Handle Accessibility Service Executions
        const execution = await prisma.accessibilityExecution.findFirst({
          where: { stripePaymentIntentId: session.id }
        });
        if (execution && execution.status !== "PAID") {
          const amount = Number(execution.approvedBudget || 0);
          const tenantId = execution.tenantId;

          await prisma.$transaction(async (tx) => {
            const duplicate = await tx.stripeWebhookEvent.findUnique({ where: { id: event.id } });
            if (duplicate) return;

            let finTxId: string | undefined;
            if (tenantId) {
              const tenant = await tx.tenant.findUnique({
                where: { id: tenantId },
                select: { feePercentage: true }
              });
              const feeRate = (tenant?.feePercentage ?? 10) / 100;
              const fee = Number(amount * feeRate);

              const finTx = await tx.financialTransaction.create({
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

            await tx.accessibilityExecution.update({
              where: { id: execution.id },
              data: { status: "PAID", financialTransactionId: finTxId }
            });

            await tx.stripeWebhookEvent.create({
              data: {
                id: event.id,
                type: event.type
              }
            });
          });

          eventStored = true;
          console.log(`[Webhook] Accessibility Execution ${execution.id} PAID!`);
        }

        // 5. Handle Donations
        const donation = await prisma.donation.findFirst({
          where: { stripeCheckoutSessionId: session.id }
        });
        if (donation && donation.status === "PENDING") {
          const amount = Number(donation.amount);
          const fee = Number(donation.platformFee || 0);
          
          await prisma.$transaction(async (tx) => {
            const duplicate = await tx.stripeWebhookEvent.findUnique({ where: { id: event.id } });
            if (duplicate) return;

            const finTx = await tx.financialTransaction.create({
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

            await tx.donation.update({
              where: { id: donation.id },
              data: { status: "COMPLETED", financialTransactionId: finTx.id }
            });

            await tx.stripeWebhookEvent.create({
              data: {
                id: event.id,
                type: event.type
              }
            });
          });

          eventStored = true;
          console.log(`[Webhook] Donation ${donation.id} COMPLETED!`);
        }

        // 6. Handle Memberships
        const membership = await prisma.membership.findFirst({
          where: { paymentId: session.id }
        });
        if (membership && membership.status === "PENDING") {
          const amount = Number(session.amount_total) / 100;

          await prisma.$transaction(async (tx) => {
            const duplicate = await tx.stripeWebhookEvent.findUnique({ where: { id: event.id } });
            if (duplicate) return;

            const tenant = await tx.tenant.findUnique({
              where: { id: membership.tenantId },
              select: { feePercentage: true }
            });
            const feeRate = (tenant?.feePercentage ?? 5) / 100;
            const fee = Number(amount * feeRate);

            const finTx = await tx.financialTransaction.create({
              data: {
                tenantId: membership.tenantId,
                type: "PAYMENT",
                source: "MEMBERSHIP",
                amount,
                fee,
                netAmount: amount - fee,
                status: "COMPLETED",
                paymentMethod: "CREDIT_CARD",
                stripePaymentIntentId: paymentIntentId,
                stripeChargeId: stripeChargeId
              }
            });

            await tx.membership.update({
              where: { id: membership.id },
              data: { status: "ACTIVE" }
            });

            await tx.stripeWebhookEvent.create({
              data: {
                id: event.id,
                type: event.type
              }
            });
          });

          eventStored = true;
          console.log(`[Webhook] Membership ${membership.id} activated!`);
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

    if (!eventStored) {
      await prisma.stripeWebhookEvent.create({
        data: {
          id: event.id,
          type: event.type
        }
      });
    };
  } catch (err) {
    console.error(`[Stripe Webhook Processing Error]:`, err);
    return res.status(500).send("Internal Server Error");
  }

  return res.status(200).send({ received: true });
});

export default router;
