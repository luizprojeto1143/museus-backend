import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function run() {
  console.log("=== INICIANDO INSPEÇÃO DE BANCO DE DADOS EM SRC ===");
  try {
    const tenants = await prisma.tenant.findMany({
      where: { parentId: null },
      select: { id: true, name: true, slug: true, type: true, isCityMode: true }
    });
    console.log(`Cidades/Tenants Principais (parentId: null): ${tenants.length}`);
    tenants.forEach(t => console.log(` - ID: ${t.id} | Nome: ${t.name} | Slug: ${t.slug} | Type: ${t.type} | isCityMode: ${t.isCityMode}`));

    console.log("\nEquipamentos Culturais:");
    const equips = await prisma.equipamentoCultural.findMany({
      select: { id: true, nome: true, slug: true, tipo: true, cidade: true, tenantId: true }
    });
    console.log(`Total Equipamentos: ${equips.length}`);
    equips.forEach(e => console.log(` - ID: ${e.id} | Nome: ${e.nome} | Slug: ${e.slug} | Tipo: ${e.tipo} | Cidade: ${e.cidade} | TenantId: ${e.tenantId}`));

    console.log("\nEventos:");
    const events = await prisma.event.findMany({
      select: { id: true, title: true, status: true, tenantId: true, equipamentoId: true }
    });
    console.log(`Total Eventos: ${events.length}`);
    events.forEach(ev => console.log(` - ID: ${ev.id} | Título: ${ev.title} | Status: ${ev.status} | TenantId: ${ev.tenantId} | EquipId: ${ev.equipamentoId}`));

    console.log("\nRoteiros (Trails):");
    const trails = await prisma.trail.findMany({
      select: { id: true, title: true, active: true, tenantId: true }
    });
    console.log(`Total Roteiros: ${trails.length}`);
    trails.forEach(tr => console.log(` - ID: ${tr.id} | Título: ${tr.title} | Active: ${tr.active} | TenantId: ${tr.tenantId}`));

    console.log("\nAchievements (Conquistas):");
    const achievements = await prisma.achievement.findMany({
      select: { id: true, title: true, tenantId: true }
    });
    console.log(`Total Conquistas: ${achievements.length}`);
    achievements.forEach(a => console.log(` - ID: ${a.id} | Título: ${a.title} | TenantId: ${a.tenantId}`));

    console.log("\nVisitantes (Top 10):");
    const visitors = await prisma.visitor.findMany({
      orderBy: { xp: "desc" },
      take: 10,
      select: { id: true, name: true, email: true, xp: true, tenantId: true }
    });
    visitors.forEach(v => console.log(` - ID: ${v.id} | Nome: ${v.name} | Email: ${v.email} | XP: ${v.xp} | TenantId: ${v.tenantId}`));

  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
export {};
