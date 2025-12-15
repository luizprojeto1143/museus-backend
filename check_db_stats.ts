import { prisma } from "./src/prisma";

async function main() {
    const tenants = await prisma.tenant.count();
    const users = await prisma.user.count();
    const works = await prisma.work.count();
    const visitors = await prisma.visitor.count();

    console.log("--- Database Stats ---");
    console.log(`Tenants: ${tenants}`);
    console.log(`Users: ${users}`);
    console.log(`Works: ${works}`);
    console.log(`Visitors: ${visitors}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
