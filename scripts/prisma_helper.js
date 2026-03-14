import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

/**
 * Optimizes the DATABASE_URL for Supabase Pooler (Transaction Mode)
 * Force port 6543 and adds pgbouncer=true
 */
export function getOptimizedDatabaseUrl(url) {
    if (!url) return url;
    
    if (url.includes("supabase.com") || url.includes("supabase.co") || url.includes("pooler.supabase.com")) {
        // Just ensure mandatory parameters, don't force port here
        // as start_deploy.js handles the port testing
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
