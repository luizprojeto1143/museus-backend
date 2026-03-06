import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const admin = await prisma.user.findFirst({
        where: { email: 'cidadedemo@culturaviva.com' },
        include: { tenant: true }
    });

    if (!admin || !admin.tenantId) return console.log("Admin or Tenant not found");

    const tenantId = admin.tenantId;
    console.log(`Checking aggregation for City: ${admin.tenant.name} (${tenantId})`);

    // Get all child tenant IDs
    const children = await prisma.tenant.findMany({
        where: { parentId: tenantId },
        select: { id: true, name: true }
    });

    const allRelatedTenantIds = [tenantId, ...children.map(c => c.id)];

    console.log(`Found ${children.length} child tenants: ${children.map(c => c.name).join(', ')}`);
    console.log(`Total related IDs: ${allRelatedTenantIds.length}`);

    // Verify Counts
    const [
        totalProjects,
        totalEvents,
        totalAccessibilityExecutions
    ] = await Promise.all([
        prisma.culturalProject.count({ where: { tenantId: { in: allRelatedTenantIds } } }),
        prisma.event.count({ where: { tenantId: { in: allRelatedTenantIds } } }),
        prisma.accessibilityExecution.count({ where: { tenantId: { in: allRelatedTenantIds } } })
    ]);

    console.log("\n--- AGGREGATED COUNTS ---");
    console.log(`Projects: ${totalProjects}`);
    console.log(`Events:   ${totalEvents}`);
    console.log(`Access:   ${totalAccessibilityExecutions}`);

    // Break down by tenant
    console.log("\n--- BREAKDOWN BY TENANT ---");
    for (const id of allRelatedTenantIds) {
        const t = await prisma.tenant.findUnique({ where: { id } });
        const p = await prisma.culturalProject.count({ where: { tenantId: id } });
        const e = await prisma.event.count({ where: { tenantId: id } });
        const a = await prisma.accessibilityExecution.count({ where: { tenantId: id } });
        console.log(`${t?.name || 'Unknown'}: Projects=${p}, Events=${e}, Access=${a}`);
    }
}

main().finally(() => prisma.$disconnect());
