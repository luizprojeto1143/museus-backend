// Em uma aplicação real Node.js hiperescala, instalaríamos o pacote 'pino'.
// npm install pino pino-pretty
// Como estamos fazendo a refatoração baseada no que temos disponível agora, 
// criaremos um wrapper que emula o formato de log estruturado JSON do Pino/Winston.

import { v4 as uuidv4 } from 'uuid';

export const logger = {
  info: (message: string, meta: Record<string, any> = {}) => {
    console.log(JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      message,
      ...meta
    }));
  },
  warn: (message: string, meta: Record<string, any> = {}) => {
    console.warn(JSON.stringify({
      level: 'warn',
      timestamp: new Date().toISOString(),
      message,
      ...meta
    }));
  },
  error: (message: string, meta: Record<string, any> = {}) => {
    console.error(JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      message,
      ...meta
    }));
  }
};
