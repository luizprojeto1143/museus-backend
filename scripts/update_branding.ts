import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Updating Cultura Viva branding to Cinematic Lux defaults...');

  // Update Main Tenant
  const tenant = await prisma.tenant.updateMany({
    where: {
      OR: [
        { slug: 'cultura-viva' },
        { name: { contains: 'Cultura Viva' } }
      ]
    },
    data: {
      primaryColor: '#d4af37', // Imperial Gold
      secondaryColor: '#05050c', // Obsidian
      theme: 'dark'
    }
  });

  console.log(`Updated ${tenant.count} tenants.`);
  
  // Update default equipment if any
  const equips = await prisma.equipamento.updateMany({
    where: {
      corPrimaria: '#2a1108' // Old brown
    },
    data: {
      corPrimaria: '#d4af37',
      corSecundaria: '#05050c'
    }
  });

  console.log(`Updated ${equips.count} equipments.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
