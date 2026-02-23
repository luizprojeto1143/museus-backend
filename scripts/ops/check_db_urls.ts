import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkUrls() {
    console.log("--- Checking Work Image URLs ---");
    const works = await prisma.work.findMany({
        take: 10,
        select: { id: true, title: true, imageUrl: true }
    });

    works.forEach(w => {
        console.log(`Work: ${w.title}`);
        console.log(`URL: ${w.imageUrl || "NULL"}`);
        console.log("---");
    });

    console.log("--- Checking Tenant Logo/Cover URLs ---");
    const tenants = await prisma.tenant.findMany({
        take: 5,
        select: { id: true, name: true, logoUrl: true, coverImageUrl: true }
    });

    tenants.forEach(t => {
        console.log(`Tenant: ${t.name}`);
        console.log(`Logo: ${t.logoUrl || "NULL"}`);
        console.log(`Cover: ${t.coverImageUrl || "NULL"}`);
        console.log("---");
    });

    await prisma.$disconnect();
}

checkUrls().catch(console.error);
