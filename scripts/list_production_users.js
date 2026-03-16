import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log("👥 Fetching production users...");
    const users = await prisma.user.findMany({
        include: { 
            tenant: { select: { name: true, slug: true } }
        }
    });

    const summary = users.map(u => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        tenant: u.tenant ? u.tenant.name : 'NONE',
        tenantId: u.tenantId,
        createdAt: u.createdAt
    }));

    console.log(JSON.stringify(summary, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
