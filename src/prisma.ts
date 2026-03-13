import { PrismaClient } from "@prisma/client";

const getDatabaseUrl = () => {
  let url = process.env.DATABASE_URL || "";
  if (url.includes("pooler.supabase.com") && !url.includes("pgbouncer=true")) {
    const separator = url.includes("?") ? "&" : "?";
    url += `${separator}pgbouncer=true&connection_limit=20`;
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
