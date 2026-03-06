import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const museum = await prisma.tenant.findFirst({ where: { slug: 'museu-demo' } });
    if (!museum) return console.log("Museum demo not found");

    console.log(`Creating dummy data for Museum: ${museum.name} (${museum.id})`);

    // 1. Create a Project
    await prisma.culturalProject.create({
        data: {
            tenantId: museum.id,
            proponentId: "eb16be7e-6839-472b-88a3-fe0d661eb2c0",
            title: "Reforma Estrutural Acessível",
            description: "Projeto para melhoria de rampas e sinalização",
            status: "SUBMITTED",
            culturalCategory: "INFRASTRUCTURE"
        }
    });

    // 2. Create an Event
    await prisma.event.create({
        data: {
            tenantId: museum.id,
            title: "Inauguração da Ala Nova",
            description: "Abertura com visita guiada em Libras",
            startDate: new Date(),
            endDate: new Date(new Date().setHours(new Date().getHours() + 2)),
            location: "Ala Sul"
        }
    });

    // 3. Create an Accessibility Action
    await prisma.accessibilityExecution.create({
        data: {
            tenantId: museum.id,
            serviceType: "LIBRAS_INTERPRETATION",
            requestNotes: "Contratação de intérprete para evento",
            status: "PENDING",
            requestedBy: "eb16be7e-6839-472b-88a3-fe0d661eb2c0"
        }
    });

    console.log("Dummy data created successfully!");
}

main().finally(() => prisma.$disconnect());
