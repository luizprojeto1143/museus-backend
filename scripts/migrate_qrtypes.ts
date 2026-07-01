import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting QRType migration...');

  // Map old types to new types
  const typeMap: Record<string, string> = {
    'EQUIPAMENTO': 'EQUIPMENT',
    'SPACE': 'ROOM',
  };

  for (const [oldType, newType] of Object.entries(typeMap)) {
    const result = await prisma.qRCode.updateMany({
      where: { type: oldType as any },
      data: { type: newType as any },
    });
    console.log(`Migrated ${result.count} QRCodes from ${oldType} to ${newType}`);
  }

  // Handle TENANT separately as it might map to CITY or EQUIPMENT based on tenantType
  const tenantQRCodes = await prisma.qRCode.findMany({
    where: { type: 'TENANT' as any },
    include: { tenant: true }
  });

  let cityCount = 0;
  let equipmentCount = 0;

  for (const qr of tenantQRCodes) {
    let newType = 'CITY';
    if (['MUSEUM', 'CULTURAL_SPACE', 'THEATER'].includes(qr.tenant.type)) {
      newType = 'EQUIPMENT';
      equipmentCount++;
    } else {
      cityCount++;
    }
    await prisma.qRCode.update({
      where: { id: qr.id },
      data: { type: newType as any },
    });
  }

  console.log(`Migrated ${tenantQRCodes.length} TENANT QRCodes: ${cityCount} to CITY, ${equipmentCount} to EQUIPMENT`);

  console.log('Migration complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
