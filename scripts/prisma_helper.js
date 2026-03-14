import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

/**
 * Optimizes the DATABASE_URL for Supabase Pooler (Transaction Mode)
 * Force port 6543 and adds pgbouncer=true
 */
export function getOptimizedDatabaseUrl(url) {
    if (!url) return url;
    
    if (url.includes("supabase.com") || url.includes("supabase.co") || url.includes("pooler.supabase.com")) {
        // 1. Force Port 6543 (transactional pooler)
        if (url.includes("@")) {
            const parts = url.split("@");
            const hostPart = parts[1];
            if (hostPart.includes(":")) {
                parts[1] = hostPart.replace(/:(\d+)/, ":6543");
            } else {
                const hostEnd = hostPart.indexOf("/") !== -1 ? hostPart.indexOf("/") : (hostPart.indexOf("?") !== -1 ? hostPart.indexOf("?") : hostPart.length);
                parts[1] = hostPart.slice(0, hostEnd) + ":6543" + hostPart.slice(hostEnd);
            }
            url = parts.join("@");
        }

        // 2. Ensure mandatory query parameters
        if (!url.includes("pgbouncer=true")) {
            const sep = url.includes("?") ? "&" : "?";
            url += `${sep}pgbouncer=true`;
        }
        if (!url.includes("connection_limit=")) {
            url += "&connection_limit=10";
        }
        if (!url.includes("sslmode=")) {
            url += "&sslmode=require";
        }
        if (!url.includes("pool_timeout=")) {
            url += "&pool_timeout=90";
        }
        return url;
    }
    return url;
}

/**
 * Returns a configured PrismaClient instance
 */
export function createPrismaClient() {
    const url = getOptimizedDatabaseUrl(process.env.DATABASE_URL);
    return new PrismaClient({
        datasources: { db: { url } },
        log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query', 'info', 'warn', 'error'],
    });
}
