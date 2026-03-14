import { createPrismaClient } from "./prisma_helper.js";
const p = createPrismaClient();

async function main() {
    console.log("🔍 Database Integrity Scan:");
    
    // Check Users
    const users = await p.user.findMany({ select: { id: true } });
    const userIds = new Set(users.map(u => u.id));
    console.log(`- Total Users: ${users.length}`);

    // Check Visitors
    const visitors = await p.visitor.findMany({ select: { id: true } });
    const visitorIds = new Set(visitors.map(v => v.id));
    console.log(`- Total Visitors: ${visitors.length}`);

    // Check Bookings for orphan users
    const bookings = await p.booking.findMany({ select: { id: true, userId: true } });
    const orphanBookings = bookings.filter(b => !userIds.has(b.userId));
    console.log(`- Orphan Bookings (User missing): ${orphanBookings.length}`);

    // Check VisitorVisits for orphan visitors
    const visits = await p.visitorVisit.findMany({ select: { id: true, visitorId: true, workId: true } });
    const orphanVisits = visits.filter(v => !visitorIds.has(v.visitorId));
    console.log(`- Orphan Visits (Visitor missing): ${orphanVisits.length}`);

    // Check for orphan works in visits
    const works = await p.work.findMany({ select: { id: true } });
    const workIds = new Set(works.map(w => w.id));
    const orphanWorkVisits = visits.filter(v => v.workId && !workIds.has(v.workId));
    console.log(`- Visits pointing to missing Works: ${orphanWorkVisits.length}`);

    if (orphanBookings.length > 0 || orphanVisits.length > 0) {
        console.warn("⚠️ CRITICAL: Data integrity issues found that could crash Prisma includes!");
    } else {
        console.log("✅ Basic integrity looks good.");
    }
}

main().catch(console.error).finally(() => p.$disconnect());
