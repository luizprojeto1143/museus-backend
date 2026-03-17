const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Buscando registros órfãos em VisitorRPG...');

  const allRpg = await prisma.visitorRPG.findMany();
  console.log(`Total VisitorRPG: ${allRpg.length}`);

  for (const rpg of allRpg) {
    const visitor = await prisma.visitor.findUnique({
      where: { id: rpg.visitorId }
    });

    if (!visitor) {
      console.log(`❌ Órfão encontrado! VisitorId: ${rpg.visitorId}. Removendo...`);
      await prisma.visitorRPG.delete({
        where: { id: rpg.id }
      });
    } else {
      console.log(`✅ Registro ok: ${rpg.visitorId} (${visitor.email})`);
    }
  }

  console.log('✨ Limpeza concluída!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
