import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function runQA() {
    console.log("=== STARTING E2E BACKEND QA TEST ===");
    try {
        // 1. Get or create a Tenant
        let tenant = await prisma.tenant.findFirst({ where: { slug: 'qa-tenant' } });
        if (!tenant) {
            tenant = await prisma.tenant.create({
                data: {
                    name: 'QA Museum',
                    slug: 'qa-tenant',
                    type: 'MUSEUM'
                }
            });
        }
        console.log(`[OK] Tenant: ${tenant.name}`);

        // 2. Get or create an Admin
        let admin = await prisma.user.findFirst({ where: { email: 'qa_admin@example.com' } });
        if (!admin) {
            admin = await prisma.user.create({
                data: {
                    name: 'QA Admin',
                    email: 'qa_admin@example.com',
                    password: await bcrypt.hash('123456', 10),
                    role: 'ADMIN',
                    tenantId: tenant.id
                }
            });
        }
        console.log(`[OK] Admin User: ${admin.email}`);

        // 3. Create a Work (Obra)
        const work = await prisma.work.create({
            data: {
                title: 'QA Masterpiece',
                artist: 'QA Artist',
                type: 'PAINTING',
                tenantId: tenant.id,
                qrCode: `QR-QA-${Date.now()}`
            }
        });
        console.log(`[OK] Created Work: ${work.title}`);

        // 4. Create an Event
        const event = await prisma.event.create({
            data: {
                title: 'QA Exclusive Tour',
                description: 'A test event for QA',
                date: new Date(),
                location: 'Main Hall',
                tenantId: tenant.id,
                type: 'WORKSHOP',
                isPaid: false,
                capacity: 50
            }
        });
        console.log(`[OK] Created Event: ${event.title}`);

        // 5. Get or create a Visitor
        let visitor = await prisma.user.findFirst({ where: { email: 'qa_visitor@example.com' } });
        if (!visitor) {
            visitor = await prisma.user.create({
                data: {
                    name: 'QA Visitor',
                    email: 'qa_visitor@example.com',
                    password: await bcrypt.hash('123456', 10),
                    role: 'VISITOR'
                }
            });
        }
        console.log(`[OK] Visitor User: ${visitor.email}`);

        // 6. Register to Event (Get Ticket)
        const ticket = await prisma.ticket.create({
            data: {
                userId: visitor.id,
                eventId: event.id,
                status: 'VALID',
                qrCode: `TKT-QA-${Date.now()}`
            }
        });
        console.log(`[OK] Generated Ticket: ${ticket.id}`);

        // 7. Check-in Event
        const checkedInTicket = await prisma.ticket.update({
            where: { id: ticket.id },
            data: {
                status: 'USED',
                usedAt: new Date()
            }
        });
        console.log(`[OK] Event Check-in Successful for Ticket: ${checkedInTicket.id}`);

        // 8. Check-in Work (Scan QR)
        const visit = await prisma.visit.create({
            data: {
                userId: visitor.id,
                workId: work.id,
                tenantId: tenant.id
            }
        });
        console.log(`[OK] Work Scanned Successful. Visit ID: ${visit.id}`);

        console.log("=== ALL QA TESTS PASSED SUCCESSFULLY ===");

    } catch (e) {
        console.error("❌ QA TEST FAILED:", e);
    } finally {
        await prisma.$disconnect();
    }
}

runQA();
