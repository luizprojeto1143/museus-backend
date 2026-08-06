
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const tenants = await prisma.tenant.findMany({ select: { slug: true, name: true } });
  console.log('TENANTS:', tenants);
}
main().catch(console.error).finally(() => prisma.$disconnect());

