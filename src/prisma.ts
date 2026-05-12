import { PrismaClient } from "@prisma/client";

const getDatabaseUrl = () => {
  let url = process.env.DATABASE_URL || "";
  
  const isSupabase = url.includes("supabase.com") || url.includes("supabase.co") || url.includes("pooler.supabase.com");
  
  if (isSupabase) {
    // 1. Ensure Port (don't force 6543 if already set by start_deploy.js)
    if (!url.includes("@")) return url;
    
    // 2. Ensure mandatory quality of service parameters
    const sep = url.includes("?") ? "&" : "?";
    if (!url.includes("sslmode=")) {
      url += `${sep}sslmode=require`;
    }
    if (!url.includes("connect_timeout=")) {
      url += "&connect_timeout=60";
    }

    // 3. Mandatory for Transaction Mode Pooler (Port 6543)
    if (url.includes(":6543") && !url.includes("pgbouncer=")) {
      url += "&pgbouncer=true";
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
