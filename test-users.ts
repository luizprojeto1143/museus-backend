import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany({
        select: { email: true, role: true, tenantId: true }
    });
    console.log("Users:", users);

    const tenants = await prisma.tenant.findMany({
        select: { id: true, name: true, type: true, parentId: true }
    });
    console.log("Tenants:", tenants);
}

main().finally(() => prisma.$disconnect());
