import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const tenants = await prisma.tenant.findMany({
        select: { id: true, name: true, slug: true, type: true }
    });
    console.log("Tenants count:", tenants.length);
    console.log("Tenants:\n", JSON.stringify(tenants, null, 2));

    const counts = {
        users: await prisma.user.count(),
        works: await prisma.work.count(),
        events: await prisma.event.count(),
        categories: await prisma.category.count(),
        registrations: await prisma.registration.count(),
        projects: await prisma.culturalProject.count(),
        accessibilityExecutions: await prisma.accessibilityExecution.count(),
    };
    console.log("Row counts:", JSON.stringify(counts, null, 2));

    const admins = await prisma.user.findMany({
        where: { role: "ADMIN" },
        select: { id: true, email: true, tenantId: true }
    });
    console.log("Admins:\n", JSON.stringify(admins, null, 2));
}

main()
    .catch((e) => console.error(e))
    .finally(() => prisma.$disconnect());
