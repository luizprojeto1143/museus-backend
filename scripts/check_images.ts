
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    const worksWithoutImage = await prisma.work.findMany({
        where: {
            OR: [
                { imageUrl: null },
                { imageUrl: "" }
            ]
        },
        select: {
            id: true,
            title: true,
            artist: true
        }
    });

    const allWorks = await prisma.work.count();

    console.log(`Total works: ${allWorks}`);
    console.log(`Works without images: ${worksWithoutImage.length}`);

    if (worksWithoutImage.length > 0) {
        console.log("Works needing images:");
        worksWithoutImage.forEach(w => {
            console.log(`- ${w.title} (Artist: ${w.artist || 'Unknown'}) [ID: ${w.id}]`);
        });
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
