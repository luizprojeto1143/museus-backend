import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log("🔍 Fetching recent audit logs...");
    const logs = await prisma.auditLog.findMany({
        take: 20,
        orderBy: { createdAt: 'desc' }
    });

    console.log(JSON.stringify(logs, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
