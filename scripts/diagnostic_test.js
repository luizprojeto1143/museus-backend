import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("🧪 Testing Production DB Connection...");
    try {
        const worksCount = await prisma.work.count();
        console.log(`✅ Connection OK. Total works: ${worksCount}`);
        
        const firstTrail = await prisma.trail.findFirst();
        console.log(`✅ Trail model check OK. First trail ownerId: ${firstTrail?.ownerId || 'null'}`);
        
        const firstTenant = await prisma.tenant.findFirst();
        console.log(`✅ Tenant model check OK. Name: ${firstTenant?.name}`);
    } catch (e) {
        console.error("❌ Error during diagnostic queries:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
