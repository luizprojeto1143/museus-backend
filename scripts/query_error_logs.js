import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const logs = await prisma.auditLog.findMany({
    where: {
      createdAt: {
        gte: yesterday
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  console.log(JSON.stringify(logs, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
