import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../logger/pino.logger.js';

const redisUrl = process.env.REDIS_URL || '';
const hasRedis = !!redisUrl && (redisUrl.startsWith('redis://') || redisUrl.startsWith('rediss://'));

// Conexão Redis compartilhada
export const redisConnection = hasRedis ? new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
}) : null;

if (redisConnection) {
  redisConnection.on('error', (err) => {
    logger.warn('Redis Connection Error (Ignorar se não tiver Redis local rodando durante o dev): ' + err.message);
  });
}

// Nomes das Filas
export const QUEUES = {
  BACKGROUND_TASKS: 'BACKGROUND_TASKS',
  ANALYTICS: 'ANALYTICS_QUEUE',
  NOTIFICATIONS: 'NOTIFICATIONS_QUEUE'
};

class MockQueue {
  name: string;
  constructor(name: string) { this.name = name; }
  async add(name: string, data: any, opts?: any) {
    logger.info(`[MockQueue ${this.name}] Ignorando job ${name} porque não há REDIS configurado.`);
  }
}

// Instanciando as Filas
export const backgroundQueue = hasRedis ? new Queue(QUEUES.BACKGROUND_TASKS, { connection: redisConnection as any }) : new MockQueue(QUEUES.BACKGROUND_TASKS) as any;
export const analyticsQueue = hasRedis ? new Queue(QUEUES.ANALYTICS, { connection: redisConnection as any }) : new MockQueue(QUEUES.ANALYTICS) as any;

// Monitor de Eventos da Fila (Opcional, bom para logs)
const queueEvents = hasRedis ? new QueueEvents(QUEUES.BACKGROUND_TASKS, { connection: redisConnection as any }) : null;

if (queueEvents) {
  queueEvents.on('completed', ({ jobId }) => {
    logger.info(`[BullMQ] Job ${jobId} completed successfully`);
  });

  queueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error(`[BullMQ] Job ${jobId} failed: ${failedReason}`);
  });
}

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
