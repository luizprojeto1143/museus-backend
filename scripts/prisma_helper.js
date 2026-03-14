import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

/**
 * Optimizes the DATABASE_URL for Supabase Pooler (Transaction Mode)
 * Force port 6543 and adds pgbouncer=true
 */
export function getOptimizedDatabaseUrl(url) {
    if (!url) return url;
    
    // Check if it's a Supabase hosted database
    if (url.includes("supabase.com") || url.includes("supabase.co") || url.includes("pooler.supabase.com")) {
        try {
            // Using a safe protocol replacement for URL parsing
            const urlObj = new URL(url.replace("postgres://", "http://").replace("postgresql://", "http://"));
            
            // 1. Force Transaction Pooler Port
            urlObj.port = "6543";
            
            // 2. Set mandatory parameters for transaction mode
            urlObj.searchParams.set("pgbouncer", "true");
            urlObj.searchParams.set("connection_limit", "10"); // Keep it lean
            urlObj.searchParams.set("pool_timeout", "90");
            urlObj.searchParams.set("sslmode", "require");
            
            // Revert back to original protocol
            const protocol = url.startsWith("postgresql://") ? "postgresql://" : "postgres://";
            return urlObj.toString().replace("http://", protocol);
        } catch (e) {
            console.error("⚠️ Error optimizing DB URL:", e.message);
            // Minimal fallback: just append if not already there
            if (!url.includes("pgbouncer=true")) {
                const sep = url.includes("?") ? "&" : "?";
                return `${url}${sep}pgbouncer=true&connection_limit=10`;
            }
        }
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
