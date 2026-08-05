import cron from 'node-cron';
import { prisma } from '../prisma.js';
import * as admin from 'firebase-admin';

export const initCronJobs = () => {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    console.log('[Cron] Checking for upcoming events to send reminders...');
    try {
      const now = new Date();
      // Look for events starting between 45 to 60 minutes from now
      const targetStart = new Date(now.getTime() + 45 * 60000);
      const targetEnd = new Date(now.getTime() + 60 * 60000);

      const events = await prisma.event.findMany({
        where: {
          startDate: {
            gte: targetStart,
            lt: targetEnd,
          },
          status: { not: 'CANCELED' }
        },
        
      });

      for (const event of events) {
        // Find all confirmed registrations for this event
        const registrations = await prisma.registration.findMany({
          where: {
            eventId: event.id,
            status: 'CONFIRMED',
            visitorId: { not: null }
          },
          include: {
            visitor: {
              include: {
                deviceTokens: {
                  where: { active: true }
                }
              }
            }
          }
        });

        const tokens: string[] = [];
        for (const reg of registrations) {
          if (reg.visitor) {
            for (const dt of reg.visitor.deviceTokens) {
              tokens.push(dt.token);
            }
          }
        }

        if (tokens.length > 0 && admin.apps.length > 0) {
          const message = {
            notification: {
              title: `Seu evento começa em 1 hora!`,
              body: `${event.title} em ${event.location || event.city || 'seu equipamento cultural'} esta quase comecando. Nao esqueca seu QR Code de acesso.`
            },
            data: {
              type: 'EVENT_REMINDER',
              eventId: event.id,
              url: `/meus-ingressos`
            },
            tokens: Array.from(new Set(tokens)) // Unique tokens
          };

          const response = await admin.messaging().sendEachForMulticast(message);
          console.log(`[Cron] Sent ${response.successCount} reminders for event ${event.id}`);
        }
      }
    } catch (err) {
      console.error('[Cron] Error in event reminder job', err);
    }
  });

  // Run every 30 minutes to retry failed/stale sponsor payouts (Outbox retry)
  cron.schedule('*/30 * * * *', async () => {
    console.log('[Cron] Checking for failed or stale sponsor payouts to retry...');
    try {
      const { stripe } = await import('../services/stripeService.js');
      // Payouts that are PROCESSING or FAILED and are of type SPONSOR
      const pendingSponsorPayouts = await prisma.payoutLedger.findMany({
        where: {
          recipientType: 'SPONSOR',
          status: { in: ['PROCESSING', 'FAILED'] },
          createdAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } // At least 5 mins old to avoid racing with active webhooks
        }
      });

      for (const payout of pendingSponsorPayouts) {
        console.log(`[Cron] Retrying sponsor outbox transfer for PayoutLedger ${payout.id}...`);
        try {
          const transfer = await stripe.transfers.create({
            amount: Math.round(Number(payout.netAmount) * 100),
            currency: 'brl',
            destination: payout.recipientId,
            description: `Repasse Patrocínio (Retry): PayoutLedger ${payout.id}`
          }, {
            idempotencyKey: `transfer-sponsor-payout-${payout.id}`
          });

          await prisma.payoutLedger.update({
            where: { id: payout.id },
            data: {
              status: 'PAID',
              stripeTransferId: transfer.id,
              paidAt: new Date()
            }
          });
          console.log(`[Cron] Sponsor outbox transfer successful for PayoutLedger ${payout.id}!`);
        } catch (err: any) {
          console.error(`[Cron] Failed to process retry for PayoutLedger ${payout.id}:`, err.message);
          await prisma.payoutLedger.update({
            where: { id: payout.id },
            data: { status: 'FAILED' }
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[Cron] Error in sponsor payout retry job', err);
    }
  });

  console.log('[Cron] Push notification reminder and sponsor outbox retry jobs scheduled.');
};



