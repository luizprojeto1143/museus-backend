import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Running migration: Deactivating vestiges without coordinates...');
  const result = await prisma.work.updateMany({
    where: {
      OR: [
        { lat: null },
        { lng: null }
      ],
      vestigeActive: true
    },
    data: {
      vestigeActive: false
    }
  });
  console.log(`Updated ${result.count} works.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
