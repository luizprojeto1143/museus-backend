
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("🔍 Checking for tenants without equipments...");
  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null },
    include: { _count: { select: { equipamentos: true } } }
  });

  const orphans = tenants.filter(t => t._count.equipamentos === 0);
  console.log(`📊 Found ${tenants.length} total tenants, ${orphans.length} orphans.`);

  for (const tenant of orphans) {
    console.log(`🔨 Fixing orphan tenant: ${tenant.name} (${tenant.slug})`);
    try {
      await prisma.equipamentoCultural.create({
        data: {
          nome: `Sede - ${tenant.name}`,
          slug: `${tenant.slug}-sede`,
          tipo: 'museu',
          endereco: tenant.address || 'Endereço Principal',
          cidade: 'Sua Cidade',
          estado: 'MG',
          lat: tenant.latitude,
          lng: tenant.longitude,
          tenantId: tenant.id
        }
      });
    } catch (err) {
      console.error(`Failed to fix ${tenant.name}:`, err.message);
    }
  }

  console.log("✅ Done.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
