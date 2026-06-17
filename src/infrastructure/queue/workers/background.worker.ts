import { Worker, Job } from 'bullmq';
import { redisConnection, QUEUES } from '../bullmq.setup.js';
import { logger } from '../../logger/pino.logger.js';
import { prisma } from '../../../prisma.js';

/**
 * Background Worker Principal
 * Processa eventos assíncronos pesados desacoplados da request principal.
 */
export const backgroundWorker = redisConnection ? new Worker(QUEUES.BACKGROUND_TASKS, async (job: Job) => {
  logger.info(`[Worker] Processing job ${job.name} (ID: ${job.id})`);

  switch (job.name) {
    case 'BookingCreated':
      await handleBookingCreated(job.data);
      break;
    
    case 'GenerateAnalyticsReport':
      await handleGenerateAnalyticsReport(job.data);
      break;

    case 'AwardGamificationXP':
      await handleAwardGamificationXP(job.data);
      break;

    case 'IncrementViews':
      await handleIncrementViews(job.data);
      break;

    default:
      logger.warn(`[Worker] Unknown job name: ${job.name}`);
  }
}, { connection: redisConnection as any }) : null;

// ----------------------------------------------------
// Handlers Assíncronos (Executados fora da requisição)
// ----------------------------------------------------

async function handleBookingCreated(data: { visitorId: string, providerId: string, value: number }) {
  try {
    // 1. Atualizar Analytics de forma assíncrona
    // Em vez de travar o checkout, computamos as estatísticas aqui
    logger.info(`[Worker/BookingCreated] Updating analytics for provider ${data.providerId}...`);
    // Simulando delay pesado de analytics/data warehouse
    await new Promise(resolve => setTimeout(resolve, 500));

    // 2. Dar CulturaCoins para o visitante (Gamificação)
    const xpGained = Math.floor(data.value * 0.1); // 10% do valor gasto vira XP
    await prisma.visitor.update({
      where: { id: data.visitorId },
      data: { xp: { increment: xpGained } }
    });
    
    logger.info(`[Worker/BookingCreated] Awarded ${xpGained} XP to visitor ${data.visitorId}`);
  } catch (error: any) {
    logger.error(error, '[Worker/BookingCreated] Error:');
    throw error; // Lança o erro para o BullMQ fazer o Retry automático (exponential backoff configurado no setup)
  }
}

async function handleGenerateAnalyticsReport(data: { tenantId: string, emailTo: string }) {
  logger.info(`[Worker/Analytics] Generating heavy PDF report for tenant ${data.tenantId}...`);
  // Lógica pesada de query no DB, geração de PDF via Puppeteer/PDFKit, envio via SendGrid...
  await new Promise(resolve => setTimeout(resolve, 2000));
  logger.info(`[Worker/Analytics] Report sent to ${data.emailTo}`);
}

async function handleAwardGamificationXP(data: { visitorId: string, xp: number, reason: string }) {
  logger.info(`[Worker/XP] Awarding ${data.xp} XP to ${data.visitorId} for ${data.reason}`);
  try {
    await prisma.visitor.update({
      where: { id: data.visitorId },
      data: { xp: { increment: data.xp } }
    });
  } catch (error: any) {
    logger.error(error, `[Worker/XP] Failed to award XP:`);
    throw error;
  }
}

async function handleIncrementViews(data: { eventId?: string, spaceId?: string, count: number }) {
  try {
    if (data.eventId) {
      await prisma.event.update({
        where: { id: data.eventId },
        data: { views: { increment: data.count } }
      });
    }
  } catch (error: any) {
    logger.error(error, `[Worker/Views] Failed to increment views:`);
  }
}

// Tratamento de erros do Worker (Falhas de conexão com Redis, etc)
if (backgroundWorker) {
  backgroundWorker.on('error', (err: any) => {
    logger.error(err, '[Worker] Fatal error:');
  });
}
