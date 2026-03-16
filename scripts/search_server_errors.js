import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log("🔥 Searching for SERVER_ERRORS in production...");
    const errors = await prisma.auditLog.findMany({
        where: { action: "SERVER_ERROR" },
        orderBy: { createdAt: 'desc' },
        take: 10
    });

    console.log(JSON.stringify(errors, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
