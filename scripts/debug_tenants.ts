import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("--- TENANTS (CIDADES) ---");
  const tenants = await prisma.tenant.findMany({
    include: {
      _count: {
        select: { equipamentos: true, works: true }
      }
    }
  });
  console.table(tenants.map(t => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    equipamentos: t._count.equipamentos,
    obras: t._count.works
  })));

  console.log("\n--- EQUIPAMENTOS CULTURAIS ---");
  const equips = await prisma.equipamentoCultural.findMany({
    select: {
      id: true,
      name: true,
      tenantId: true,
      ativo: true
    }
  });
  console.table(equips);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
