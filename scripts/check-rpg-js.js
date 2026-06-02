import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('--- Database Check (JS) ---');
  
  try {
    const characters = await prisma.characterBase.findMany();
    console.log(`Total CharacterBase: ${characters.length}`);
    characters.forEach(c => console.log(`- ${c.name} (${c.id})`));

    const rpgs = await prisma.visitorRPG.findMany({
      include: { visitor: { select: { email: true } }, selectedCharacter: { select: { name: true } } }
    });
    console.log(`\nTotal VisitorRPG: ${rpgs.length}`);
    rpgs.forEach(r => console.log(`- Visitor: ${r.visitor.email}, Character: ${r.selectedCharacter?.name || 'NONE'}`));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
