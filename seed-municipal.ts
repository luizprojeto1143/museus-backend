import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    // 1. Find City Tenant
    let city = await prisma.tenant.findFirst({ where: { type: { in: ['CITY', 'SECRETARIA'] } } });
    if (!city) {
        city = await prisma.tenant.create({
            data: {
                name: 'Cidade Demontrativa',
                slug: 'cidade-demontrativa-' + Date.now().toString(),
                type: 'CITY',
                isCityMode: true,
                featureAccessibilityMgmt: true,
                featureProjects: true
            }
        });
    }

    // 2. Link the existing Museum to this City
    const museum = await prisma.tenant.findFirst({ where: { type: 'MUSEUM' } });
    if (museum) {
        await prisma.tenant.update({
            where: { id: museum.id },
            data: { parentId: city.id, accessibilityResources: { physical: ["Rampa"], content: ["Libras"] } }
        });
    }

    // 3. Create a secondary child tenant (Theater)
    const theaterSlug = 'teatro-municipal-' + Date.now().toString();
    const existingTheater = await prisma.tenant.findUnique({ where: { slug: theaterSlug } });
    let theater = existingTheater;
    if (!theater) {
        theater = await prisma.tenant.create({
            data: {
                name: 'Teatro Municipal',
                slug: theaterSlug,
                type: 'CULTURAL_SPACE',
                parentId: city.id,
                accessibilityResources: null // No accessibility
            }
        });
    }

    // 4. Create cultural projects for City
    await prisma.culturalProject.create({
        data: {
            title: 'Projeto Cultural Viva LBI',
            description: 'Implementação de acessibilidade',
            status: 'APPROVED',
            tenantId: city.id,
            accessibilityPlan: 'Libras e Audiodescrição em todos os eventos',
            budget: 150000,
            goals: '100% de acessibilidade'
        }
    });

    await prisma.culturalProject.create({
        data: {
            title: 'Fomento a Novos Artistas',
            description: 'Editais',
            status: 'SUBMITTED',
            tenantId: city.id,
            budget: 50000
        }
    });

    // 5. Create Accessibility Execution
    await prisma.accessibilityExecution.create({
        data: {
            tenantId: museum?.id || city.id,
            serviceType: 'LIBRAS_INTERPRETATION',
            status: 'COMPLETED',
            requestedBy: 'Secretaria',
            createdAt: new Date(),
            executedAt: new Date()
        }
    });

    await prisma.accessibilityExecution.create({
        data: {
            tenantId: museum?.id || city.id,
            serviceType: 'AUDIO_DESCRIPTION',
            status: 'PENDING',
            requestedBy: 'Secretaria',
            createdAt: new Date()
        }
    });

    // 6. Create Event to add estimated public impact
    const evt = await prisma.event.create({
        data: {
            title: 'Festival de Inverno',
            startDate: new Date(new Date().getTime() - 86400000), // Yesterday
            endDate: new Date(new Date().getTime() + 86400000), // Tomorrow
            tenantId: city.id,
            status: 'PUBLISHED'
        }
    });

    // create some registrations
    const ticket = await prisma.ticket.create({
        data: {
            eventId: evt.id,
            name: 'Entrada Franca',
            quantity: 1000,
            sold: 120
        }
    });

    await prisma.registration.create({
        data: {
            code: 'REG-' + Date.now().toString(),
            eventId: evt.id,
            ticketId: ticket.id,
            guestName: 'Visitante Demo',
            guestEmail: 'demo@visitante.com'
        }
    });

    console.log("Database seeded successfully.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
