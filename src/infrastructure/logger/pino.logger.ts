import pino from 'pino';

// Pino logger setup
// Em produção, os logs vão puros em JSON pro stdout, 
// o que é perfeito para Datadog/ElasticSearch/CloudWatch lerem nativamente.
// Em dev, usamos pino-pretty para ficar colorido no terminal.
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
        },
      }
    : undefined,
});
