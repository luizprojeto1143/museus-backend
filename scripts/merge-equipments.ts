import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function mergeEquipments() {
  console.log("🚀 Iniciando consolidação de equipamentos...");

  const tenants = await prisma.tenant.findMany({
    include: {
      equipamentos: {
        include: {
          _count: {
            select: {
              works: true,
              events: true,
              trails: true
            }
          }
        }
      }
    }
  });

  for (const tenant of tenants) {
    console.log(`\n🏢 Tenant: ${tenant.name} (${tenant.id})`);
    
    if (tenant.equipamentos.length <= 1) {
      console.log("   ✅ Nenhum duplicado encontrado.");
      continue;
    }

    // Identificar o equipamento "alvo" (aquele que já tem dados ou o primeiro)
    const sorted = [...tenant.equipamentos].sort((a, b) => {
      const aData = a._count.works + a._count.events + a._count.trails;
      const bData = b._count.works + b._count.events + b._count.trails;
      if (bData !== aData) return bData - aData; // Quem tem mais dado ganha
      return a.createdAt.getTime() - b.createdAt.getTime(); // Mais antigo ganha
    });

    const target = sorted[0];
    const duplicates = sorted.slice(1);

    console.log(`   🎯 Alvo: ${target.nome} (${target.id}) - Dados: ${target._count.works} obras, ${target._count.events} eventos`);
    console.log(`   🗑️ Duplicados para remover: ${duplicates.length}`);

    for (const dup of duplicates) {
      console.log(`      - Movendo dados de ${dup.nome} (${dup.id})...`);
      
      // Mover Obras
      const works = await prisma.work.updateMany({
        where: { equipamentoId: dup.id },
        data: { equipamentoId: target.id }
      });
      
      // Mover Eventos
      const events = await prisma.event.updateMany({
        where: { equipamentoId: dup.id },
        data: { equipamentoId: target.id }
      });

      // Mover Trilhas
      const trails = await prisma.trail.updateMany({
        where: { equipamentoId: dup.id },
        data: { equipamentoId: target.id }
      });

      // Mover Checkins
      const checkins = await prisma.equipamentoCheckin.updateMany({
        where: { equipamentoId: dup.id },
        data: { equipamentoId: target.id }
      });

      console.log(`        ✅ ${works.count} obras, ${events.count} eventos, ${trails.count} trilhas movidas.`);

      // Deletar equipamento duplicado
      await prisma.equipamentoCultural.delete({
        where: { id: dup.id }
      });
      console.log(`        ❌ Equipamento duplicado removido.`);
    }
  }

  console.log("\n✨ Consolidação concluída com sucesso!");
  process.exit(0);
}

mergeEquipments().catch(err => {
  console.error("❌ Erro fatal:", err);
  process.exit(1);
});
