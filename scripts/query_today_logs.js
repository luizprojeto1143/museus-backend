import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log(`📅 Searching for logs from ${today.toISOString()} to now...`);
    const logs = await prisma.auditLog.findMany({
        where: {
            createdAt: { gte: today }
        },
        orderBy: { createdAt: 'desc' },
        take: 50
    });

    console.log(JSON.stringify(logs, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
