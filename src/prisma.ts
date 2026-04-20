import { PrismaClient } from "@prisma/client";

const getDatabaseUrl = () => {
  let url = process.env.DATABASE_URL || "";
  
  const isSupabase = url.includes("supabase.com") || url.includes("supabase.co") || url.includes("pooler.supabase.com");
  
  if (isSupabase) {
    // 1. Ensure Port (don't force 6543 if already set by start_deploy.js)
    if (!url.includes("@")) return url;
    
    // 2. Ensure mandatory query parameters for Supabase stability
    if (!url.includes("pgbouncer=")) {
      const sep = url.includes("?") ? "&" : "?";
      url += `${sep}pgbouncer=true`;
    }
    if (!url.includes("connection_limit=")) {
      url += "&connection_limit=2";
    }
    if (!url.includes("pool_timeout=")) {
      url += "&pool_timeout=90";
    }

    const maskedUrl = url.replace(/:[^:@]+@/, ":****@");
    console.log(`🔌 [PRISMA] Supabase connection parameters optimized: ${maskedUrl}`);
  }
  
  return url;
};

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: getDatabaseUrl(),
    },
  },
  log: ['error', 'warn'],
});

console.log("[PRISMA] PrismaClient inicializado.");
