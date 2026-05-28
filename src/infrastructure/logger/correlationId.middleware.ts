import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './pino.logger.js';

export const correlationIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Pega o ID caso já venha do gateway ou front, senao cria um novo
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  
  // Anexa na request para os controllers usarem
  req.headers['x-correlation-id'] = correlationId as string;
  
  // Loga o inicio da request
  logger.info({ correlationId, ip: req.ip } as any, 'Request Context');

  // Pega o tempo de resposta
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({ correlationId, statusCode: res.statusCode, durationMs: duration } as any, 'Response Context');
    logger.info({ 
      correlationId, 
      statusCode: res.statusCode,
      durationMs: duration 
    } as any, `[${req.method}] ${req.originalUrl} - Completed`);
  });

  next();
};
