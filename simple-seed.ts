import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const city = await prisma.tenant.findFirst({ where: { type: 'CITY' } });
    const museum = await prisma.tenant.findFirst({ where: { type: 'MUSEUM' } });
    if (city && museum) {
        await prisma.tenant.update({
            where: { id: museum.id },
            data: { parentId: city.id, accessibilityResources: { physical: ["Rampa"], content: ["Libras"] } }
        });
        console.log("Updated museum parentId to city.id!");
    }
}
main().finally(() => prisma.$disconnect());
