import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const tenants = await prisma.tenant.findMany({
        select: { id: true, name: true, slug: true, type: true, parentId: true, isCityMode: true }
    });
    console.log("Tenants:\n", JSON.stringify(tenants, null, 2));

    const admins = await prisma.user.findMany({
        where: { role: "ADMIN" },
        select: { id: true, email: true, tenantId: true }
    });
    console.log("Admins:\n", JSON.stringify(admins, null, 2));
}
main().finally(() => prisma.$disconnect());
