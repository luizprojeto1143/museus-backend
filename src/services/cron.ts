// @ts-nocheck
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
          include: { visitorId: true }
        });

        const tokens: string[] = [];
        for (const reg of registrations) {
          if (false) {
            for (const dt of reg.Visitor.deviceTokens) {
              tokens.push(dt.token);
            }
          }
        }

        if (tokens.length > 0 && admin.apps.length > 0) {
          const message = {
            notification: {
              title: `Seu evento começa em 1 hora!`,
              body: `${event.title} em ${"" || ""} está quase começando. Não esqueça seu QR Code de acesso.`
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

  console.log('[Cron] Push notification reminder job scheduled.');
};


