import { PrismaClient } from "@prisma/client";

const getDatabaseUrl = () => {
  let url = process.env.DATABASE_URL || "";
  
  // Se for Supabase Pooler, garante configurações otimizadas
  if (url.includes("pooler.supabase.com")) {
    const urlObj = new URL(url);
    
    // Forçar pgbouncer=true se estiver usando o pooler
    urlObj.searchParams.set("pgbouncer", "true");
    
    // Forçar um limite de conexões maior para evitar o timeout de 9 conexões (padrão do Prisma em ambiente com poucas vCPUs)
    // Supabase costuma aceitar 20+ no pooler.
    urlObj.searchParams.set("connection_limit", "20");
    
    // Aumentar o timeout do pool para 60 segundos (padrão é menor)
    urlObj.searchParams.set("pool_timeout", "60");

    url = urlObj.toString();
  }
  
  return url;
};

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: getDatabaseUrl(),
    },
  },
  log: ['query', 'info', 'warn', 'error'],
});
