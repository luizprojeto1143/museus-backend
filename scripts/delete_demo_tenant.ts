import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const targetSlug = "Casa-Fiat-de-Cultura";
  const tenant = await prisma.tenant.findUnique({
    where: { slug: targetSlug }
  });

  if (!tenant) {
    console.log(`❌ Tenant com slug '${targetSlug}' não encontrado.`);
    return;
  }

  const tenantId = tenant.id;
  console.log(`🗑️ Iniciando limpeza profunda para: ${tenant.name} (${tenantId})`);

  try {
    console.log("-> Removendo dados vinculados (limpeza manual de segurança)...");
    
    // Limpeza de tabelas que podem não ter cascade total ou causar travas
    await prisma.review.deleteMany({ where: { visitor: { tenantId } } });
    await prisma.visitorVisit.deleteMany({ where: { tenantId } });
    await prisma.visitorAchievement.deleteMany({ where: { visitor: { tenantId } } });
    await prisma.passportStamp.deleteMany({ where: { visitor: { tenantId } } });
    await prisma.registration.deleteMany({ where: { event: { tenantId } } });
    await prisma.booking.deleteMany({ where: { tenantId } });
    await prisma.work.deleteMany({ where: { tenantId } });
    await prisma.event.deleteMany({ where: { tenantId } });
    await prisma.trail.deleteMany({ where: { tenantId } });
    await prisma.equipamentoCultural.deleteMany({ where: { tenantId } });
    await prisma.visitor.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    
    console.log("-> Removendo Tenant final...");
    await prisma.tenant.delete({
      where: { id: tenantId }
    });

    console.log(`✅ Sucesso! '${tenant.name}' foi completamente removido.`);
  } catch (error) {
    console.error("❌ Erro durante a limpeza:", error);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
