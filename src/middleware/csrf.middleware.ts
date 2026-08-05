/**
 * CSRF Protection — Double-Submit Cookie Pattern
 *
 * Como funciona:
 * 1. Frontend chama GET /auth/csrf-token
 * 2. O servidor gera um token aleatório, salva num cookie HttpOnly e retorna o valor no body
 * 3. Para cada mutação (POST/PUT/DELETE/PATCH), o frontend envia o header x-csrf-token com o valor
 * 4. O middleware compara o header com o cookie — se bater, passa
 *
 * Rotas que usam APENAS Bearer token (Authorization: Bearer ...) são automaticamente isentas
 * porque o cookie não é enviado nessas requisições.
 *
 * Rotas isentas explicitamente:
 * - POST /webhooks/stripe (autenticado por Stripe-Signature)
 * - POST /auth/login, /auth/register (não precisam de CSRF pois não há sessão ainda)
 * - GET de qualquer rota (somente leitura)
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const CSRF_COOKIE_NAME  = '__csrf';
const CSRF_HEADER_NAME  = 'x-csrf-token';
const CSRF_TOKEN_LENGTH = 32; // bytes → 64 chars hex
const CSRF_COOKIE_TTL   = 60 * 60 * 8; // 8 horas

// Métodos que modificam estado e precisam de proteção CSRF
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Caminhos explicitamente isentos de CSRF (autenticam por outro mecanismo)
const CSRF_EXEMPT_PATHS = [
  '/webhooks',          // Stripe autentica via Stripe-Signature
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/recover-password',
  '/auth/reset-password',
];

function isExempt(path: string): boolean {
  return CSRF_EXEMPT_PATHS.some(exempt => path.startsWith(exempt));
}

/**
 * Gera ou recupera o token CSRF para esta sessão.
 * Seta o cookie se não existir.
 */
export function getCsrfToken(req: Request, res: Response): string {
  const existing = req.cookies?.[CSRF_COOKIE_NAME];
  if (existing && typeof existing === 'string' && existing.length === CSRF_TOKEN_LENGTH * 2) {
    return existing;
  }
  const token = crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,   // Precisa ser false para o JS do frontend poder lê-lo
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: CSRF_COOKIE_TTL * 1000,
    path: '/'
  });
  return token;
}

/**
 * Middleware CSRF.
 *
 * Passa se:
 * - Método é GET/HEAD/OPTIONS
 * - Rota está na lista de isentos
 * - Requisição usa APENAS Bearer token (sem cookie museus_token)
 * - Header x-csrf-token bate exatamente com o cookie __csrf
 */
export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Métodos seguros (leitura) — sempre passa
  if (!UNSAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // Rotas isentas
  if (isExempt(req.path)) {
    next();
    return;
  }

  // Se a requisição NÃO tem o cookie museus_token, está usando Bearer token
  // (caso típico de mobile ou integração direta) — isenta de CSRF
  const hasSessionCookie = !!(req.cookies?.museus_token);
  if (!hasSessionCookie) {
    next();
    return;
  }

  // Tem cookie de sessão → exige CSRF token
  const cookieToken  = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken  = req.headers[CSRF_HEADER_NAME];

  if (!cookieToken || !headerToken) {
    res.status(403).json({
      message: 'CSRF token ausente. Obtenha o token em GET /auth/csrf-token e envie no header x-csrf-token.'
    });
    return;
  }

  // Comparação segura (timing-safe)
  try {
    const cookieBuf = Buffer.from(cookieToken as string, 'hex');
    const headerBuf = Buffer.from(headerToken  as string, 'hex');
    if (cookieBuf.length !== headerBuf.length || !crypto.timingSafeEqual(cookieBuf, headerBuf)) {
      res.status(403).json({ message: 'CSRF token inválido.' });
      return;
    }
  } catch {
    res.status(403).json({ message: 'CSRF token malformado.' });
    return;
  }

  next();
}
