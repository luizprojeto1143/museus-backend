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

    // Check RefreshToken table existence
    try {
        const rtCount = await p.refreshToken.count();
        console.log("RefreshToken count:", rtCount);
    } catch (e) {
        console.error("❌ ERROR: RefreshToken table might be missing!", e.message);
    }

    const tenants = await p.tenant.findMany({ select: { id: true, slug: true, name: true } });
    console.log("All Tenants:", JSON.stringify(tenants, null, 2));
}

main().catch(console.error).finally(() => p.$disconnect());
