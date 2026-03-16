import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { id: "8cc9b546-7f7d-4908-a6cf-acdd7b86982b" }
  });

  console.log(JSON.stringify(tenant, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
