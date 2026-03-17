const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Database Check (CharacterBase) ---');
  
  try {
    const characters = await prisma.characterBase.findMany();
    console.log(`Total CharacterBase: ${characters.length}`);
    characters.forEach(c => {
      console.log(`- ID: ${c.id}`);
      console.log(`  Name: ${c.name}`);
      console.log(`  Active: ${c.active}`);
      console.log(`  TenantId: ${c.tenantId}`);
      console.log(`  Image: ${c.imageUrl}`);
      console.log('---');
    });

    const rpgCount = await prisma.visitorRPG.count();
    console.log(`\nTotal VisitorRPG Records: ${rpgCount}`);

    const visitorsWithRpg = await prisma.visitorRPG.findMany({
        take: 5,
        select: {
            visitorId: true,
            selectedCharacterId: true,
            characterName: true
        }
    });
    console.log('\nSample VisitorRPGs:');
    visitorsWithRpg.forEach(v => console.log(`- Visitor: ${v.visitorId}, Char: ${v.selectedCharacterId}, Name: ${v.characterName}`));

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
