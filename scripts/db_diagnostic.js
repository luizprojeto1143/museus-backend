import { createPrismaClient } from "./prisma_helper.js";
const p = createPrismaClient();

async function main() {
    console.log("🔍 Database Diagnostic:");
    const users = await p.user.findMany({ include: { tenant: true } });
    console.log("Users and their Tenants:");
    console.log(JSON.stringify(users.map(u => ({ 
        id: u.id, 
        email: u.email, 
        role: u.role,
        tenantId: u.tenantId, 
        tenantSlug: u.tenant?.slug 
    })), null, 2));

    // Check active connections
    const connections = await p.$queryRaw`SELECT count(*) FROM pg_stat_activity`;
    console.log("Current active connections:", Number(connections[0].count));

    // Check specific connections for this app
    const appConnections = await p.$queryRaw`SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE '%prisma%'`;
    console.log("Prisma connections:", Number(appConnections[0].count));

    const tenants = await p.tenant.findMany({ select: { id: true, slug: true, name: true } });
    console.log("All Tenants:", JSON.stringify(tenants, null, 2));
}

main().catch(console.error).finally(() => p.$disconnect());
