import { PrismaClient } from "@prisma/client";

const getDatabaseUrl = () => {
  let url = process.env.DATABASE_URL || "";
  
  // Check if it's Supabase (direct or pooler)
  const isSupabase = url.includes("supabase.com") || url.includes("supabase.co") || url.includes("pooler.supabase.com");
  
  if (isSupabase) {
    try {
      const urlObj = new URL(url.replace("postgres://", "http://").replace("postgresql://", "http://"));
      
      // 1. Force Port 6543 for Transaction Pooler
      urlObj.port = "6543";
      
      // 2. Performance & stability params
      urlObj.searchParams.set("pgbouncer", "true");
      urlObj.searchParams.set("connection_limit", "10"); 
      urlObj.searchParams.set("pool_timeout", "90");
      urlObj.searchParams.set("sslmode", "require");

      const finalUrl = urlObj.toString().replace("http://", url.startsWith("postgresql://") ? "postgresql://" : "postgres://");
      
      const maskedUrl = finalUrl.replace(/:[^:@]+@/, ":****@");
      console.log(`🔌 [PRISMA] Using optimized Supabase Pooler (Port 6543): ${maskedUrl}`);
      return finalUrl;
    } catch (e) {
      console.error("❌ [PRISMA] URL parsing failed, using fallback:", e);
    }
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
