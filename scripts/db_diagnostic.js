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

    const tenants = await p.tenant.findMany();
    console.log("\nAll Tenants:");
    console.log(JSON.stringify(tenants.map(t => ({ id: t.id, slug: t.slug, name: t.name })), null, 2));
}

main().catch(console.error).finally(() => p.$disconnect());
