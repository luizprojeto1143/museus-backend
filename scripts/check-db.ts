
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.company.findUnique({
    where: { id: '8cc9b546-7f7d-4908-a6cf-acdd7b86982b' }
  });
  console.log("TENANT SETTINGS:", {
    name: tenant?.name,
    logoUrl: tenant?.logoUrl,
    theme: tenant?.theme,
    primaryColor: tenant?.primaryColor
  });

  const equip = await prisma.equipamentoCultural.findFirst({
    where: { companyId: '8cc9b546-7f7d-4908-a6cf-acdd7b86982b' }
  });
  console.log("EQUIPAMENTO SETTINGS:", {
    name: equip?.nome,
    logoUrl: equip?.logoUrl,
    theme: (equip as any).theme, // Some fields might be in JSON or missing from types
    primaryColor: equip?.corPrimaria
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
