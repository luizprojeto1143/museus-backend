import { PrismaClient } from "@prisma/client";

const getDatabaseUrl = () => {
  let url = process.env.DATABASE_URL || "";
  
  const isSupabase = url.includes("supabase.com") || url.includes("supabase.co") || url.includes("pooler.supabase.com");
  
  if (isSupabase) {
    // 1. Force Port 6543 (transactional pooler)
    // Replaces any port pattern :DDDD with :6543
    if (url.includes("@")) {
      const parts = url.split("@");
      const hostPart = parts[1];
      if (hostPart.includes(":")) {
        // Replace existing port
        parts[1] = hostPart.replace(/:(\d+)/, ":6543");
      } else {
        // Add port to hostname
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

    const maskedUrl = url.replace(/:[^:@]+@/, ":****@");
    console.log(`🔌 [PRISMA] Supabase detected. Optimized URL: ${maskedUrl}`);
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
