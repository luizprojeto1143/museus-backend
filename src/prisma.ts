import { PrismaClient } from "@prisma/client";

const getDatabaseUrl = () => {
  let url = process.env.DATABASE_URL || "";
  
  if (url.includes("pooler.supabase.com")) {
    try {
      // Usar uma abordagem mais robusta para garantir os parâmetros
      const urlObj = new URL(url.replace("postgres://", "http://").replace("postgresql://", "http://"));
      
      urlObj.searchParams.set("pgbouncer", "true");
      urlObj.searchParams.set("connection_limit", "50");
      urlObj.searchParams.set("pool_timeout", "90");

      const finalUrl = urlObj.toString()
        .replace("http://", url.startsWith("postgresql://") ? "postgresql://" : "postgres://");
      
      const maskedUrl = finalUrl.replace(/:[^:@]+@/, ":****@");
      console.log(`[PRISMA] Usando URL otimizada para Supabase: ${maskedUrl}`);
      return finalUrl;
    } catch (e) {
      console.error("[PRISMA] Erro ao processar URL do banco:", e);
      // Fallback para append simples se falhar
      if (!url.includes("pgbouncer=true")) {
        const sep = url.includes("?") ? "&" : "?";
        url += `${sep}pgbouncer=true&connection_limit=50&pool_timeout=90`;
      }
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
