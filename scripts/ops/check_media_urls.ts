import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkUrls() {
    try {
        const works = await prisma.work.findMany({
            where: {
                OR: [
                    { audioUrl: { not: null } },
                    { librasUrl: { not: null } }
                ]
            },
            take: 5,
            select: {
                id: true,
                title: true,
                audioUrl: true,
                librasUrl: true
            }
        });

        console.log("Checking Media URLs for up to 5 works:");
        works.forEach(w => {
            console.log(`Work: ${w.title}`);
            console.log(`  - Audio: ${w.audioUrl}`);
            console.log(`  - Libras: ${w.librasUrl}`);
        });

    } catch (error) {
        console.error("Error:", error);
    } finally {
        await prisma.$disconnect();
    }
}

checkUrls();
