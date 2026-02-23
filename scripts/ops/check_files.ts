import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkFiles() {
    console.log("--- Checking Recent Uploads (File Table) ---");
    const files = await prisma.file.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        select: { id: true, filename: true, url: true, type: true, createdAt: true, usedIn: true, usedInId: true }
    });

    files.forEach(f => {
        console.log(`File: ${f.filename} (${f.type})`);
        console.log(`URL: ${f.url}`);
        console.log(`Used In: ${f.usedIn || "NULL"} (ID: ${f.usedInId || "NULL"})`);
        console.log(`Created At: ${f.createdAt}`);
        console.log("---");
    });

    await prisma.$disconnect();
}

checkFiles().catch(console.error);
