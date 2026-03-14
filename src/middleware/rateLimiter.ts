import rateLimit from "express-rate-limit";

// Global limiter: generous for general browsing
export const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 500, // allows high-throughput for event check-ins, etc.
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        message: "Muitas requisições deste IP, tente novamente mais tarde.",
    },
});

// Strict limiter for authentication (brute-force protection)
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100, // Loosened for debugging
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        message: "Muitas tentativas de login. Aguarde 15 minutos.",
    },
});

// Strict limiter for public form submissions (anti-spam)
export const formLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        message: "Limite de envios atingido. Tente novamente mais tarde.",
    },
});

// AI endpoints (expensive - prevent abuse)
export const aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 10, // 10 AI requests per minute
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        message: "Limite de requisições de IA atingido. Aguarde um momento.",
    },
});
