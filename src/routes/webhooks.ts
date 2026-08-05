import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { mailService } from "../services/email.js";
import { stripeService, stripe } from "../services/stripeService.js";
import { applyRefundSuccess } from "../domains/infrastructure/financial.js";
import { syncLedgerEntry } from "../services/ledgerService.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role, SponsorshipStatus, SponsorshipTier } from "@prisma/client";
import { deliverTenantWebhooks } from "../services/outboundWebhook.service.js";

const router = Router();
const MAX_SHARED_SPONSORS_PER_WORK = 10;
const RESERVED_SPONSORSHIP_STATUSES = [SponsorshipStatus.PENDING, SponsorshipStatus.ACTIVE];

async function createFinancialTransactionOnce(tx: any, data: any) {
  const duplicateKeys = [
    data.stripePaymentIntentId ? { stripePaymentIntentId: data.stripePaymentIntentId } : null,
    data.stripeChargeId ? { stripeChargeId: data.stripeChargeId } : null
  ].filter(Boolean);

  if (duplicateKeys.length > 0) {
    const existing = await tx.financialTransaction.findFirst({
      where: {
        source: data.source,
        OR: duplicateKeys
      }
    });

    if (existing) {
      return existing;
    }
  }

  const finTx = await tx.financialTransaction.create({ data });
  await syncLedgerEntry(tx, finTx.id);
  return finTx;
}

async function applyChargebackLost(dispute: any, finTx: any) {
  const chargebackAmount = dispute.amount / 100;
  const idempotencyKey = `chargeback-${dispute.id}-debit`;

  await prisma.$transaction(async (tx) => {
    await tx.financialTransaction.update({
      where: { id: finTx.id },
      data: { status: "CHARGEBACK" }
    });

    await tx.financialLedgerEntry.upsert({
      where: { idempotencyKey },
      create: {
        tenantId: finTx.tenantId,
        sourceType: "CHARGEBACK",
        sourceId: dispute.id,
        direction: "DEBIT",
        grossAmount: chargebackAmount,
        gatewayFee: 0,
        platformFee: 0,
        netAmount: chargebackAmount,
        currency: (dispute.currency as string | undefined)?.toUpperCase() || "BRL",
        status: "COMPLETED",
        paymentMethod: finTx.paymentMethod,
        stripePaymentIntentId: finTx.stripePaymentIntentId || (dispute.payment_intent as string | undefined),
        stripeChargeId: finTx.stripeChargeId || (dispute.charge as string | undefined),
        idempotencyKey,
        competenceDate: new Date((dispute.created || Math.floor(Date.now() / 1000)) * 1000),
        settlementDate: new Date()
      },
      update: {
        grossAmount: chargebackAmount,
        netAmount: chargebackAmount,
        status: "COMPLETED",
        settlementDate: new Date()
      }
    });
  });
}

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

      // 0. Handle direct work sponsorship subscriptions
      if (metadata?.workSponsorshipId) {
        const sponsorshipId = String(metadata.workSponsorshipId);
        const activatedSponsorships: Array<{
          id: string;
          tenantId: string;
          workId: string;
          sponsorName: string;
          sponsorEmail: string | null;
          sponsorLogo: string | null;
          sponsorUrl: string | null;
          tier: SponsorshipTier;
        }> = [];

        await prisma.$transaction(async (tx) => {
          const sponsorship = await tx.workSponsorship.findUnique({
            where: { id: sponsorshipId }
          });

          if (!sponsorship || sponsorship.status === SponsorshipStatus.ACTIVE) {
            return;
          }

          const lockedWorks = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM "Work" WHERE id = ${sponsorship.workId} FOR UPDATE
          `;

          if (!lockedWorks[0]) {
            await tx.workSponsorship.update({
              where: { id: sponsorship.id },
              data: { status: SponsorshipStatus.CANCELLED, active: false, endDate: new Date() }
            });
            return;
          }

          const reserved = await tx.workSponsorship.findMany({
            where: {
              workId: sponsorship.workId,
              id: { not: sponsorship.id },
              status: { in: RESERVED_SPONSORSHIP_STATUSES }
            },
            select: { tier: true }
          });

          const hasExclusiveSponsor = reserved.some(s => s.tier === SponsorshipTier.EXCLUSIVE);
          const sharedSponsorsCount = reserved.filter(s => s.tier === SponsorshipTier.SHARED).length;
          const violatesExclusive = sponsorship.tier === SponsorshipTier.EXCLUSIVE && reserved.length > 0;
          const violatesSharedExclusive = sponsorship.tier === SponsorshipTier.SHARED && hasExclusiveSponsor;
          const violatesSharedLimit = sponsorship.tier === SponsorshipTier.SHARED && sharedSponsorsCount >= MAX_SHARED_SPONSORS_PER_WORK;

          if (violatesExclusive || violatesSharedExclusive || violatesSharedLimit) {
            await tx.workSponsorship.update({
              where: { id: sponsorship.id },
              data: { status: SponsorshipStatus.CANCELLED, active: false, endDate: new Date() }
            });
            console.error(`[Webhook] Sponsorship ${sponsorship.id} paid but violates sponsorship slot rules. Marked as CANCELLED for manual review.`);
            return;
          }

          const updated = await tx.workSponsorship.update({
            where: { id: sponsorship.id },
            data: {
              status: SponsorshipStatus.ACTIVE,
              active: true,
              startDate: new Date(),
              stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
              stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : undefined
            }
          });

          activatedSponsorships.push({
            id: updated.id,
            tenantId: updated.tenantId,
            workId: updated.workId,
            sponsorName: updated.sponsorName,
            sponsorEmail: updated.sponsorEmail,
            sponsorLogo: updated.sponsorLogo,
            sponsorUrl: updated.sponsorUrl,
            tier: updated.tier
          });
        });

        for (const sponsorship of activatedSponsorships) {
          deliverTenantWebhooks(sponsorship.tenantId, "sponsorship.activated", sponsorship)
            .catch(err => console.error("Sponsorship webhook delivery failed:", err));
          console.log(`[Webhook] Sponsorship ${sponsorship.id} ACTIVE!`);
        }
      }

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
        const ticketConfirmedWebhooks: Array<{ tenantId: string; payload: Record<string, unknown> }> = [];

        const quantity = targetRegistrations.length;
        const totalAmount = targetRegistrations.reduce((acc, r) => acc + Number(r.pricePaid), 0);
        const totalFee = targetRegistrations.reduce((acc, r) => acc + Number(r.platformFee || 0), 0);

        await prisma.$transaction(async (tx) => {
          let finTxId: string | undefined;
          if (firstReg.event?.tenantId) {
            const finTx = await createFinancialTransactionOnce(tx, {
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
            });
            finTxId = finTx.id;
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

            if (firstReg.event?.tenantId) {
              ticketConfirmedWebhooks.push({
                tenantId: firstReg.event.tenantId,
                payload: {
                  eventId: firstReg.eventId,
                  ticketId,
                  quantity,
                  registrations: targetRegistrations.map(reg => ({
                    id: reg.id,
                    code: reg.code,
                    guestName: reg.guestName,
                    guestEmail: reg.guestEmail
                  }))
                }
              });
            }
          }
        });

        for (const webhook of ticketConfirmedWebhooks) {
          deliverTenantWebhooks(webhook.tenantId, "ticket.confirmed", webhook.payload)
            .catch(err => console.error("Ticket confirmed webhook delivery failed:", err));
        }
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
             const amountCents = Math.round(totalAmount * 100);
             
             // Resolvendo a taxa configurada para o webhook do teatro
             const { getPlatformFee } = await import("../services/fee.service.js");
             const { PlatformFeeSource } = await import("@prisma/client");
             const feeResult = await getPlatformFee({
               tenantId,
               sourceType: PlatformFeeSource.THEATER,
               amountCents
             });

             const finTx = await createFinancialTransactionOnce(tx, {
                 tenantId,
                 type: "PAYMENT",
                 source: "THEATER",
                 amount: totalAmount,
                 fee: feeResult.platformFeeCents / 100,
                 netAmount: totalAmount - (feeResult.platformFeeCents / 100),
                 status: "COMPLETED",
                 paymentMethod: "CREDIT_CARD",
                 stripePaymentIntentId: paymentIntentId,
                 stripeChargeId: stripeChargeId,
                 // Sprint 15 â€” fee snapshot
                 feeConfigId: feeResult.configId,
                 platformFeePercent: feeResult.percentage,
                 platformFeeAmountCents: feeResult.platformFeeCents,
                 feePaidBy: feeResult.feePaidBy


             });
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
          const finTx = await createFinancialTransactionOnce(tx, {
              tenantId: order.tenantId,
              type: "PAYMENT",
              source: "ORDER",
              amount,
              fee,
              netAmount: amount - fee,
              status: "COMPLETED",
              paymentMethod: "CREDIT_CARD",
              stripePaymentIntentId: paymentIntentId,
              stripeChargeId: stripeChargeId,
              // Sprint 15 â€” fee snapshot copied from order
              feeConfigId: order.feeConfigId,
              platformFeePercent: order.platformFeePercent,
              platformFeeAmountCents: order.platformFeeAmountCents,
              feePaidBy: order.feePaidBy

          });

          await tx.order.update({
            where: { id: order.id },
            data: { status: "PAID", financialTransactionId: finTx.id }
          });
        });

        console.log(`[Webhook] Order ${order.id} PAID!`);
      }

      // 2.5. Handle Skin Purchases (Skins Premium)
      const skinPurchase = await prisma.skinPurchase.findFirst({
        where: { stripeCheckoutSessionId: session.id }
      });
      if (skinPurchase && skinPurchase.status === "PENDING") {
        await prisma.$transaction(async (tx) => {
          // Double check purchase status for strict idempotency
          const sp = await tx.skinPurchase.findUnique({
            where: { id: skinPurchase.id }
          });
          if (!sp || sp.status === "PAID") return;

          if (sp.xpAmount && sp.xpAmount > 0) {
            const xpDebit = await tx.visitor.updateMany({
              where: {
                id: sp.visitorId,
                xp: { gte: sp.xpAmount }
              },
              data: {
                xp: { decrement: sp.xpAmount }
              }
            });

            if (xpDebit.count === 0) {
              await tx.skinPurchase.update({
                where: { id: sp.id },
                data: { status: "FAILED" }
              });
              console.error(`[Webhook] Skin Purchase ${sp.id} paid, but visitor ${sp.visitorId} no longer has enough XP.`);
              return;
            }

            const visitorAfterXp = await tx.visitor.findUnique({
              where: { id: sp.visitorId },
              select: { xp: true }
            });

            await tx.xpTransaction.create({
              data: {
                visitorId: sp.visitorId,
                type: "SPEND",
                amount: -sp.xpAmount,
                balanceAfter: visitorAfterXp?.xp ?? 0,
                reason: `Compra hibrida de skin: ${sp.skinId}`,
                sourceType: "SKIN_PURCHASE",
                sourceId: sp.id
              }
            });
          }

          // 1. Create unique visitor skin ownership
          const existingSkin = await tx.visitorSkin.findUnique({
            where: { visitorId_skinId: { visitorId: sp.visitorId, skinId: sp.skinId } }
          });

          if (!existingSkin) {
            await tx.visitorSkin.create({
              data: {
                visitorId: sp.visitorId,
                skinId: sp.skinId,
                sourcePurchaseId: sp.id
              }
            });
          }

          // 2. Create platform revenue financial transaction
          const totalAmount = Number(sp.moneyAmountCents || 0) / 100;
          const finTx = await createFinancialTransactionOnce(tx, {
              tenantId: sp.tenantId as string,
              type: "PAYMENT",
              source: "SKIN_PREMIUM",
              amount: totalAmount,
              fee: 0, // Direct platform revenue, no connecting splits
              netAmount: totalAmount,
              status: "COMPLETED",
              paymentMethod: "CREDIT_CARD",
              stripePaymentIntentId: paymentIntentId || undefined,
              stripeChargeId: stripeChargeId || undefined

          });

          // 3. Mark purchase as PAID
          await tx.skinPurchase.update({
            where: { id: sp.id },
            data: {
              status: "PAID",
              stripePaymentIntentId: paymentIntentId,
              stripeChargeId: stripeChargeId,
              financialTransactionId: finTx.id,
              paidAt: new Date(),
              platformRevenueCents: sp.moneyAmountCents,
              netPlatformRevenueCents: sp.moneyAmountCents,
              gatewayFeeCents: 0
            }
          });
        });

        console.log(`[Webhook] Skin Purchase ${skinPurchase.id} PAID!`);
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

            const finTx = await createFinancialTransactionOnce(tx, {
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
            });
            finTxId = finTx.id;
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
            // Sprint 15: Calcular taxa via Central de Taxas (ACCESSIBILITY)
            const { getPlatformFee } = await import("../services/fee.service.js");
            const { PlatformFeeSource } = await import("@prisma/client");
            const feeResult = await getPlatformFee({
              tenantId,
              sourceType: PlatformFeeSource.ACCESSIBILITY,
              amountCents: Math.round(amount * 100)
            });

            const finTx = await createFinancialTransactionOnce(tx, {
                tenantId,
                type: "PAYMENT",
                source: "ACCESSIBILITY",
                amount,
                fee: feeResult.platformFeeCents / 100,
                netAmount: amount - (feeResult.platformFeeCents / 100),
                status: "COMPLETED", 
                paymentMethod: "CREDIT_CARD",
                stripePaymentIntentId: paymentIntentId,
                stripeChargeId: stripeChargeId,
                // Sprint 15 â€” fee snapshot
                feeConfigId: feeResult.configId,
                platformFeePercent: feeResult.percentage,
                platformFeeAmountCents: feeResult.platformFeeCents,
                feePaidBy: feeResult.feePaidBy
            });
            finTxId = finTx.id;
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
          const finTx = await createFinancialTransactionOnce(tx, {
            tenantId: donation.tenantId,
            type: "PAYMENT",
            source: "DONATION",
            amount,
            fee,
            netAmount: amount - fee,
            status: "COMPLETED",
            paymentMethod: "CREDIT_CARD",
            stripePaymentIntentId: paymentIntentId,
            stripeChargeId: stripeChargeId,
            feeConfigId: donation.feeConfigId,
            platformFeePercent: donation.platformFeePercent,
            platformFeeAmountCents: donation.platformFeeAmountCents,
            feePaidBy: donation.feePaidBy
          });

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
          const finTx = await createFinancialTransactionOnce(tx, {
            tenantId: membership.tenantId,
            type: "PAYMENT",
            source: "MEMBERSHIP",
            amount,
            fee: Number(membership.platformFeeAmountCents || 0) / 100,
            netAmount: amount - (Number(membership.platformFeeAmountCents || 0) / 100),
            status: "COMPLETED",
            paymentMethod: "CREDIT_CARD",
            stripePaymentIntentId: paymentIntentId,
            stripeChargeId: stripeChargeId,
            feeConfigId: membership.feeConfigId,
            platformFeePercent: membership.platformFeePercent,
            platformFeeAmountCents: membership.platformFeeAmountCents,
            feePaidBy: "SELLER"
          });

          await tx.membership.update({
            where: { id: membership.id },
            data: { status: "ACTIVE" }
          });
        });

        console.log(`[Webhook] Membership ${membership.id} activated!`);
        deliverTenantWebhooks(membership.tenantId, "membership.activated", {
          membershipId: membership.id,
          planId: membership.planId,
          visitorEmail: membership.visitorEmail,
          visitorName: membership.visitorName,
          status: "ACTIVE",
          paymentId: membership.paymentId
        }).catch(err => console.error("Membership webhook delivery failed:", err));
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

      const workSponsorship = await prisma.workSponsorship.findUnique({
        where: { stripeSubscriptionId: subscription.id }
      });

      if (workSponsorship) {
        const isActive = status === "active" || status === "trialing";
        await prisma.workSponsorship.update({
          where: { id: workSponsorship.id },
          data: {
            status: isActive ? SponsorshipStatus.ACTIVE : SponsorshipStatus.CANCELLED,
            active: isActive,
            endDate: isActive ? null : new Date()
          }
        });
        console.log(`[Webhook] Work sponsorship ${workSponsorship.id} subscription status: ${status}`);
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

      const workSponsorship = await prisma.workSponsorship.findUnique({
        where: { stripeSubscriptionId: subscription.id }
      });

      if (workSponsorship) {
        await prisma.workSponsorship.update({
          where: { id: workSponsorship.id },
          data: {
            status: SponsorshipStatus.CANCELLED,
            active: false,
            endDate: new Date()
          }
        });
        console.log(`[Webhook] Work sponsorship ${workSponsorship.id} subscription CANCELED.`);
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
      if (dispute.status === "lost") {
        await applyChargebackLost(dispute, finTx);
      }
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
