
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const { count } = await prisma.tenant.deleteMany({
    where: {
      OR: [
        { slug: { in: ['museu-a', 'cidade-b', 'demo', 'exemplo'] } },
        { slug: { contains: 'demo', mode: 'insensitive' } },
        { slug: { contains: 'teste', mode: 'insensitive' } },
        { slug: { contains: 'exemplo', mode: 'insensitive' } },
        { slug: { contains: 'betim', mode: 'insensitive' } },
        { name: { contains: 'Equipamento Padrão', mode: 'insensitive' } },
        { name: { contains: 'demo', mode: 'insensitive' } },
        { name: { contains: 'teste', mode: 'insensitive' } },
        { name: { contains: 'exemplo', mode: 'insensitive' } }
      ]
    }
  });
  console.log('DELETED COUNT:', count);
}
main().catch(console.error).finally(() => prisma.$disconnect());

