import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../logger/pino.logger.js';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Conexão Redis compartilhada
export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

redisConnection.on('error', (err) => {
  logger.warn('Redis Connection Error (Ignorar se não tiver Redis local rodando durante o dev): ' + err.message);
});

// Nomes das Filas
export const QUEUES = {
  BACKGROUND_TASKS: 'BACKGROUND_TASKS',
  ANALYTICS: 'ANALYTICS_QUEUE',
  NOTIFICATIONS: 'NOTIFICATIONS_QUEUE'
};

// Instanciando as Filas
export const backgroundQueue = new Queue(QUEUES.BACKGROUND_TASKS, { connection: redisConnection as any });
export const analyticsQueue = new Queue(QUEUES.ANALYTICS, { connection: redisConnection as any });

// Monitor de Eventos da Fila (Opcional, bom para logs)
const queueEvents = new QueueEvents(QUEUES.BACKGROUND_TASKS, { connection: redisConnection as any });

queueEvents.on('completed', ({ jobId }) => {
  logger.info(`[BullMQ] Job ${jobId} completed successfully`);
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error(`[BullMQ] Job ${jobId} failed: ${failedReason}`);
});

/**
 * Helper genérico para adicionar jobs
 */
export async function dispatchEvent(queue: Queue, jobName: string, data: any) {
  try {
    await queue.add(jobName, data, {
      removeOnComplete: true,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }
    });
  } catch (error: any) {
    logger.error(error, `Error dispatching to queue ${queue.name}:`);
  }
}
