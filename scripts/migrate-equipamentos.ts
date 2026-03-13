import { prisma } from "../src/prisma.js";

function slugify(text: string) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD') // remove accents
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
}

async function migrate() {
  console.log("🚀 Iniciando migração de Equipamentos Culturais...");

  const tenants = await prisma.tenant.findMany();
  console.log(`📊 Encontrados ${tenants.length} tenants.`);

  for (const tenant of tenants) {
    console.log(`\n🏢 Processando Tenant: ${tenant.name} (${tenant.id})`);

    // 1. Cria o equipamento cultural 'default'
    const slug = `${slugify(tenant.name)}-${Math.random().toString(36).substring(2, 5)}`;
    
    const equip = await prisma.equipamentoCultural.create({
      data: {
        tenantId: tenant.id,
        nome: tenant.name,
        slug: slug,
        tipo: 'museu', // Default, admin pode mudar depois
        descricao: tenant.mission || "Equipamento cultural padrão do tenant.",
        endereco: tenant.address || "Endereço não informado",
        cidade: "Cidade não informada", // Tenant não tem cidade explicitamente?
        estado: "MG",
        logoUrl: tenant.logoUrl,
        fotoCapaUrl: tenant.coverImageUrl,
        ativo: true,
      }
    });

    console.log(`✅ Equipamento criado: ${equip.nome} (slug: ${equip.slug})`);

    // 2. Vincula registros existentes
    const worksCount = await prisma.work.updateMany({
      where: { tenantId: tenant.id, equipamentoId: null },
      data: { equipamentoId: equip.id }
    });
    console.log(`🖼️  Obras vinculadas: ${worksCount.count}`);

    const spacesCount = await prisma.space.updateMany({
      where: { tenantId: tenant.id, equipamentoId: null },
      data: { equipamentoId: equip.id }
    });
    console.log(`📍 Espaços vinculados: ${spacesCount.count}`);

    const trailsCount = await prisma.trail.updateMany({
      where: { tenantId: tenant.id, equipamentoId: null },
      data: { equipamentoId: equip.id }
    });
    console.log(`🚶‍♂️ Trilhas vinculadas: ${trailsCount.count}`);

    const eventsCount = await prisma.event.updateMany({
      where: { tenantId: tenant.id, equipamentoId: null },
      data: { equipamentoId: equip.id }
    });
    console.log(`📅 Eventos vinculados: ${eventsCount.count}`);
  }

  console.log("\n✨ Migração concluída com sucesso!");
}

migrate()
  .catch((e) => {
    console.error("❌ Erro durante a migração:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
