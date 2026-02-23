import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function listUsers() {
    console.log("--- Current Users ---");
    const users = await prisma.user.findMany({
        select: { email: true, name: true, role: true }
    });
    users.forEach(u => console.log(`${u.role}: ${u.email} (${u.name})`));
    await prisma.$disconnect();
}

listUsers().catch(console.error);
