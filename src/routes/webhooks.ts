import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { mailService } from "../services/email.js";
import { stripeService, stripe } from "../services/stripeService.js";
import { applyRefundSuccess } from "../domains/infrastructure/financial.js";
import { syncLedgerEntry } from "../services/ledgerService.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

/**
 * Helper to process Stripe Webhook Event case blocks.
 * Returns true if handled, false if ignored.
 */
export async function handleWebhookEvent(event: any): Promise<boolean> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as any;
      const metadata = session.metadata || {};

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
      // Aceita PENDING ou CANCELED (caso a reserva local tenha expirado por atraso, mas a Stripe session foi paga)
      const targetRegistrations = registrations.filter(r => r.status === "PENDING" || r.status === "CANCELED");
      if (targetRegistrations.length > 0) {
        const firstReg = targetRegistrations[0];
        const ticketId = firstReg.ticketId;

        const quantity = targetRegistrations.length;
        const totalAmount = targetRegistrations.reduce((acc, r) => acc + Number(r.pricePaid), 0);
        const totalFee = targetRegistrations.reduce((acc, r) => acc + Number(r.platformFee || 0), 0);

        await prisma.$transaction(async (tx) => {
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
            await syncLedgerEntry(tx, finTx.id);
          }

          // Pessimistic lock on the ticket
          const tickets = await tx.$queryRaw<any[]>`SELECT * FROM "Ticket" WHERE id = ${ticketId} FOR UPDATE`;
          const ticket = tickets[0];
          if (!ticket) throw new Error("Ingresso não encontrado durante o processamento do webhook");

          const canceledCount = targetRegistrations.filter(r => r.status === "CANCELED").length;

          if (canceledCount > 0 && ticket.sold + canceledCount > ticket.quantity) {
            console.error(`[Webhook] Overbooking detected for ticket ${ticketId}. Cannot revive ${canceledCount} canceled registrations.`);
            
            // Create a pending refund automatically if the transaction exists
            if (finTxId && firstReg.event?.tenantId) {
              await tx.refund.create({
                data: {
                  tenantId: firstReg.event.tenantId,
                  transactionId: finTxId,
                  amount: totalAmount,
                  status: "PENDING",
                  reason: "Reembolso automático: Overbooking de ingressos após expiração de reserva local",
                  retries: 0
                }
              });
            }
          } else {
            await tx.registration.updateMany({
              where: { id: { in: targetRegistrations.map(r => r.id) } },
              data: { status: "CONFIRMED", financialTransactionId: finTxId }
            });
            await tx.ticket.update({
              where: { id: ticketId },
              data: { sold: { increment: quantity } }
            });

            console.log(`[Webhook] ${quantity} Registrations CONFIRMED + sold incremented!`);

            const eventData = await tx.event.findUnique({ where: { id: firstReg.eventId } });
            for (const reg of targetRegistrations) {
              mailService.sendTicketEmail(
                reg.guestEmail,
                eventData?.title || "Evento",
                reg.guestName,
                reg.code
              ).catch(mailErr => console.error("Failed to send ticket email:", mailErr));
            }
          }
        });
      }

      // 1.5. Handle Theater Sessions (Seats)
      if (metadata && metadata.type === "THEATER") {
        const eventId = metadata.eventId;
        const reservationGroupId = metadata.reservationGroupId;
        const visitorId = metadata.visitorId || null;
        const tenantId = metadata.tenantId;
        const ticketId = metadata.ticketId || null;

        if (reservationGroupId) {
          await prisma.$transaction(async (tx) => {
            // Idempotência: verificar se transação com este PaymentIntent/Charge já existe
            const existingTx = await tx.financialTransaction.findFirst({
              where: {
                OR: [
                  paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : null,
                  stripeChargeId ? { stripeChargeId: stripeChargeId } : null
                ].filter(Boolean) as any
              }
            });

            if (existingTx) {
              console.log(`[Webhook] Transação de teatro já existente para PI ${paymentIntentId}. Skipping.`);
              return;
            }

            const reservationGroup = await tx.theaterSeatReservationGroup.findUnique({
              where: { id: reservationGroupId },
              include: { seats: true }
            });

            if (!reservationGroup) {
              throw new Error("Conflito de Assento: Grupo de reserva não encontrado.");
            }

            if (reservationGroup.stripeCheckoutSessionId && reservationGroup.stripeCheckoutSessionId !== session.id) {
              throw new Error("Conflito de Assento: Grupo de reserva associado a outro checkout.");
            }

            if (reservationGroup.status === "SOLD") {
              console.log(`[Webhook] Grupo de reserva de teatro ${reservationGroupId} já processado (SOLD). Skipping.`);
              return;
            }

            const groupSeats = reservationGroup.seats;
            for (const s of groupSeats) {
              if (s.status === "SOLD" && (s.visitorId !== visitorId || s.ticketId !== ticketId)) {
                throw new Error(`Conflito de Assento: O assento ${s.seatId} do grupo já foi vendido para outro visitante.`);
              }
            }

            // Atualizar os assentos do grupo para SOLD
            await tx.theaterSeatReservation.updateMany({
              where: { reservationGroupId: reservationGroup.id },
              data: { status: "SOLD", visitorId, ticketId, expiresAt: null, stripeCheckoutSessionId: session.id }
            });

            // Atualizar o grupo para SOLD
            await tx.theaterSeatReservationGroup.update({
              where: { id: reservationGroup.id },
              data: { status: "SOLD", expiresAt: null, stripeCheckoutSessionId: session.id }
            });

            const totalAmount = Number(session.amount_total || 0) / 100;
            
            let feeVal = 0;
            if (session.application_fee_amount) {
              feeVal = Number(session.application_fee_amount) / 100;
            } else {
              const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
              const feePercentage = tenant?.feePercentage ?? 10.0;
              feeVal = totalAmount * (feePercentage / 100);
            }

            const finTx = await tx.financialTransaction.create({
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
            await syncLedgerEntry(tx, finTx.id);
          });

          console.log(`[Webhook] Theater seats linked to group ${reservationGroupId} SOLD!`);
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

          await syncLedgerEntry(tx, finTx.id);

          await tx.order.update({
            where: { id: order.id },
            data: { status: "PAID", financialTransactionId: finTx.id }
          });
        });

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
            await syncLedgerEntry(tx, finTx.id);
          }

          await tx.transaction.update({
            where: { id: transaction.id },
            data: { status: "PAID", paidAt: new Date(), financialTransactionId: finTxId }
          });
        });

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
            await syncLedgerEntry(tx, finTx.id);
          }

          await tx.accessibilityExecution.update({
            where: { id: execution.id },
            data: { status: "PAID", financialTransactionId: finTxId }
          });
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
        
        await prisma.$transaction(async (tx) => {
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

          await syncLedgerEntry(tx, finTx.id);

          await tx.donation.update({
            where: { id: donation.id },
            data: { status: "COMPLETED", financialTransactionId: finTx.id }
          });
        });

        console.log(`[Webhook] Donation ${donation.id} COMPLETED!`);
      }

      // 6. Handle Memberships
      const membership = await prisma.membership.findFirst({
        where: { paymentId: session.id }
      });
      if (membership && membership.status === "PENDING") {
        const amount = Number(session.amount_total) / 100;

        await prisma.$transaction(async (tx) => {
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

          await syncLedgerEntry(tx, finTx.id);

          await tx.membership.update({
            where: { id: membership.id },
            data: { status: "ACTIVE" }
          });
        });

        console.log(`[Webhook] Membership ${membership.id} activated!`);
      }
      return true;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as any;
      const customerId = subscription.customer as string;
      const status = subscription.status;

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
      return true;
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
      return true;
    }

    case "charge.dispute.created":
    case "charge.dispute.updated": {
      const dispute = event.data.object as any;
      const chargeId = dispute.charge as string;

      const finTx = await prisma.financialTransaction.findFirst({
        where: { stripeChargeId: chargeId }
      });
      if (!finTx) {
        console.warn(`[Webhook] Dispute ${dispute.id} sem FinancialTransaction correspondente (chargeId=${chargeId})`);
        return true;
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
      return true;
    }

    case "charge.refunded": {
      const charge = event.data.object as any;
      const refunds = charge.refunds?.data || [];
      for (const stripeRefund of refunds) {
        if (stripeRefund.status === "succeeded") {
          const localRefundId = stripeRefund.metadata?.localRefundId;
          const stripeRefundId = stripeRefund.id;

          let localRefund = null;
          if (localRefundId) {
            localRefund = await prisma.refund.findUnique({ where: { id: localRefundId } });
          } else if (stripeRefundId) {
            localRefund = await prisma.refund.findUnique({ where: { stripeRefundId } });
          }

          if (localRefund && (localRefund.status === "PENDING" || localRefund.status === "PROCESSING")) {
            await prisma.$transaction(async (txPrisma) => {
              await applyRefundSuccess(
                txPrisma,
                localRefund.id,
                stripeRefundId,
                localRefund.transactionId,
                Number(localRefund.amount),
                localRefund.tenantId,
                localRefund.registrationId,
                localRefund.orderId
              );
            });
            console.log(`[Webhook] Consolidado reembolso local ${localRefund.id} (Stripe ID=${stripeRefundId})`);
          } else if (!localRefund) {
            // Reembolso Externo: processado via painel do Stripe
            const txRecord = await prisma.financialTransaction.findFirst({
              where: {
                OR: [
                  { stripeChargeId: charge.id },
                  { stripePaymentIntentId: charge.payment_intent as string }
                ].filter(Boolean) as any
              }
            });

            if (txRecord) {
              const amountRefunded = stripeRefund.amount / 100;
              await prisma.$transaction(async (txPrisma) => {
                // 1. Criar o reembolso local com status PENDING
                const newRefund = await txPrisma.refund.create({
                  data: {
                    transactionId: txRecord.id,
                    stripeRefundId: stripeRefund.id,
                    amount: amountRefunded,
                    status: "PENDING",
                    reason: "Reembolso externo criado via painel Stripe",
                    tenantId: txRecord.tenantId
                  }
                });

                // 2. Chamar applyRefundSuccess para processar toda a contabilidade contábil, e-mails, cancelamentos e ledger!
                await applyRefundSuccess(
                  txPrisma,
                  newRefund.id,
                  stripeRefund.id,
                  txRecord.id,
                  amountRefunded,
                  txRecord.tenantId,
                  null, // registrationId
                  null  // orderId
                );
              });
              console.log(`[Webhook] Reembolso externo processado com sucesso para transação ${txRecord.id}`);
            }
          }
        }
      }
      return true;
    }

    default: {
      console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
      return false;
    }
  }
}

/**
 * Stripe Webhook - Handles real-time payment events
 * IMPORTANT: Requires raw body for signature verification
 */
router.post("/stripe", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig as string,
      endpointSecret as string
    );
  } catch (err: any) {
    console.error(`[Stripe Webhook] Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotency Lock: Use a database status check to prevent duplicate concurrent runs
  const existingEvent = await prisma.stripeWebhookEvent.findUnique({
    where: { id: event.id }
  });

  if (existingEvent) {
    if (existingEvent.status === "PROCESSED" || existingEvent.status === "IGNORED") {
      console.log(`[Stripe Webhook] Event ${event.id} already processed or ignored (status=${existingEvent.status}). Skipping.`);
      return res.status(200).send({ received: true, duplicate: true });
    }

    if (existingEvent.status === "PROCESSING") {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      if (existingEvent.updatedAt > tenMinutesAgo) {
        console.log(`[Stripe Webhook] Event ${event.id} is currently PROCESSING. Skipping to avoid race condition.`);
        return res.status(200).send({ received: true, duplicate: true });
      }
      console.log(`[Stripe Webhook] Event ${event.id} is PROCESSING but stale (updatedAt: ${existingEvent.updatedAt.toISOString()}). Safe reprocessing allowed.`);
    }

    // Reset status to PROCESSING to retry/reprocess
    await prisma.stripeWebhookEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSING", errorMessage: null }
    });
  } else {
    try {
      await prisma.stripeWebhookEvent.create({
        data: {
          id: event.id,
          type: event.type,
          status: "PROCESSING"
        }
      });
    } catch (err: any) {
      if (err.code === "P2002") {
        console.log(`[Stripe Webhook] Race condition lock hit for event ${event.id}. Skipping.`);
        return res.status(200).send({ received: true, duplicate: true });
      }
      console.error(`[Stripe Webhook] Error creating lock:`, err);
      return res.status(500).send("Internal Server Error");
    }
  }

  console.log(`[Stripe Webhook] Received event: ${event.type}`);

  try {
    // Process the event
    const handled = await handleWebhookEvent(event);

    // Update lock status to PROCESSED or IGNORED
    await prisma.stripeWebhookEvent.update({
      where: { id: event.id },
      data: { status: handled ? "PROCESSED" : "IGNORED" }
    });

  } catch (err: any) {
    console.error(`[Stripe Webhook Processing Error]:`, err);
    try {
      await prisma.stripeWebhookEvent.update({
        where: { id: event.id },
        data: { 
          status: "FAILED",
          errorMessage: err?.message || String(err)
        }
      });
    } catch (dbErr) {
      console.error("Failed to mark webhook as FAILED:", dbErr);
    }
    return res.status(500).send("Internal Server Error");
  }

  return res.status(200).send({ received: true });
});

/**
 * Reprocess a webhook event (MASTER only)
 */
router.post("/reprocess/:eventId", authMiddleware, requireRole([Role.MASTER]), async (req: Request, res: Response): Promise<any> => {
  const { eventId } = req.params;

  const dbEvent = await prisma.stripeWebhookEvent.findUnique({
    where: { id: eventId }
  });

  if (!dbEvent) {
    return res.status(404).json({ message: "Evento de webhook não encontrado no banco de dados." });
  }

  try {
    console.log(`[Stripe Webhook Reprocess] Fetching event ${eventId} from Stripe API...`);
    const event = await stripe.events.retrieve(eventId);

    // Reset status to PROCESSING
    await prisma.stripeWebhookEvent.update({
      where: { id: eventId },
      data: { status: "PROCESSING", errorMessage: null }
    });

    // Run the webhook handler logic for this event
    const handled = await handleWebhookEvent(event);

    // Mark as PROCESSED or IGNORED
    await prisma.stripeWebhookEvent.update({
      where: { id: eventId },
      data: { status: handled ? "PROCESSED" : "IGNORED" }
    });

    return res.json({ message: "Webhook reprocessado com sucesso", status: handled ? "PROCESSED" : "IGNORED" });
  } catch (err: any) {
    console.error(`[Stripe Webhook Reprocess Error]:`, err);
    await prisma.stripeWebhookEvent.update({
      where: { id: eventId },
      data: { status: "FAILED", errorMessage: err?.message || String(err) }
    });
    return res.status(500).json({ message: "Erro ao reprocessar webhook", error: err?.message });
  }
});

export default router;
