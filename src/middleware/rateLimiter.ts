import rateLimit from "express-rate-limit";

// Global limiter: generous for general browsing
export const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 500,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        message: "Muitas requisições deste IP, tente novamente mais tarde.",
    },
});

// ─── Auth: Brute-force protection ─────────────────────────────────────────────
// 10 tentativas por 15 minutos por IP (padrão OWASP)
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true, // só conta falhas
    message: {
        message: "Muitas tentativas de login. Aguarde 15 minutos.",
    },
});

// ─── Formulários públicos: anti-spam ──────────────────────────────────────────
export const formLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        message: "Limite de envios atingido. Tente novamente mais tarde.",
    },
});

// ─── AI: caro, previne abuso ──────────────────────────────────────────────────
// 10 requisições por minuto por IP
export const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        message: "Limite de requisições de IA atingido. Aguarde um momento.",
    },
});

// ─── Gamificação: previne farm de XP ──────────────────────────────────────────
// 30 ações por minuto por IP (suficiente para uso legítimo, bloqueia bots)
export const gamificationLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        message: "Muitas ações de gamificação. Aguarde um momento.",
    },
});

// ─── Upload: previne abuso de armazenamento ────────────────────────────────────
// 20 uploads por hora por IP
export const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        message: "Limite de uploads atingido. Aguarde antes de enviar mais arquivos.",
    },
});

// ─── Recuperação de senha: evita enumeração de emails ─────────────────────────
// 5 tentativas por hora por IP
export const passwordRecoveryLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        message: "Muitas solicitações de recuperação. Tente novamente em 1 hora.",
    },
});
