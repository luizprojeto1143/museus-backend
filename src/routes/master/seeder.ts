import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { Role } from "@prisma/client";
import { fakerPT_BR as faker } from '@faker-js/faker';

const router = Router();

// Generate Fake Visitors
router.post("/generate", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
    try {
        const { tenantId, count = 10 } = req.body;
        const amount = Math.min(Math.max(Number(count), 1), 50); // Min 1, Max 50 per batch

        const createdVisitors = [];

        for (let i = 0; i < amount; i++) {
            const sex = faker.person.sexType();
            const firstName = faker.person.firstName(sex);
            const lastName = faker.person.lastName();
            const name = `${firstName} ${lastName}`;
            const email = faker.internet.email({ firstName, lastName, provider: 'gmail.com' }).toLowerCase(); // Ensure realistic provider

            // Create Visitor
            const visitor = await prisma.visitor.create({
                data: {
                    name,
                    email,
                    tenantId,
                    isFake: true,
                    xp: faker.number.int({ min: 0, max: 5000 }),
                    photoUrl: faker.image.avatar()
                }
            });
            createdVisitors.push(visitor);
        }

        return res.json({ message: `Gerados ${createdVisitors.length} visitantes`, visitors: createdVisitors });
    } catch (err) {
        console.error("Erro ao gerar visitantes", err);
        return res.status(500).json({ message: "Erro ao gerar visitantes" });
    }
});

// Delete all Fake Visitors for Tenant
router.delete("/bulk", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
    try {
        const { tenantId } = req.body;
        if (!tenantId) return res.status(400).json({ message: "Tenant ID required" });

        const deleted = await prisma.visitor.deleteMany({
            where: {
                tenantId,
                isFake: true
            }
        });

        return res.json({ message: `Removidos ${deleted.count} visitantes falsos` });
    } catch (err) {
        console.error("Erro apagar visitantes", err);
        return res.status(500).json({ message: "Erro ao apagar visitantes" });
    }
});

// Simulate Interaction (Visit / Comment)
router.post("/interact", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
    try {
        const { visitorId, type, content } = req.body; // type: 'visit', 'comment', 'review'

        const visitor = await prisma.visitor.findUnique({ where: { id: visitorId } });
        if (!visitor || !visitor.isFake) {
            return res.status(400).json({ message: "Visitante inválido ou real" });
        }

        if (type === 'visit') {
            // Find a random work
            const work = await prisma.work.findFirst({
                where: { tenantId: visitor.tenantId },
                orderBy: { id: 'asc' }, // weak random, assumes sequential or skip
                skip: Math.floor(Math.random() * 5) // Skip first few
            }) || await prisma.work.findFirst({ where: { tenantId: visitor.tenantId } });

            if (work) {
                await prisma.visitorVisit.create({
                    data: {
                        visitorId: visitor.id,
                        workId: work.id,
                        xpGained: 10,
                        source: 'DEMO'
                    }
                });
                // Award XP
                await prisma.visitor.update({
                    where: { id: visitor.id },
                    data: { xp: { increment: 10 } }
                });
            }
        } else if (type === 'guestbook') {
            await prisma.guestbookEntry.create({
                data: {
                    visitorId: visitor.id,
                    tenantId: visitor.tenantId,
                    message: content || faker.lorem.sentence(),
                }
            });
        }

        return res.json({ message: "Interação simulada" });

    } catch (err) {
        console.error("Erro interacao", err);
        return res.status(500).json({ message: "Erro simulacao" });
    }
});

// Bulk Traffic Simulation (Visits)
router.post("/simulate-traffic", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
    try {
        const { tenantId, visitorCount = 5, minVisits = 1, maxVisits = 5 } = req.body;

        // 1. Get Fake Visitors
        const visitors = await prisma.visitor.findMany({
            where: { tenantId, isFake: true },
            take: Number(visitorCount),
            orderBy: { updatedAt: 'asc' } // Rotate through oldest updated
        });

        if (visitors.length === 0) {
            return res.status(400).json({ message: "Nenhum visitante falso encontrado. Gere visitantes primeiro." });
        }

        // 2. Get Works
        const works = await prisma.work.findMany({
            where: { tenantId },
            select: { id: true }
        });

        if (works.length === 0) {
            return res.status(400).json({ message: "Nenhuma obra encontrada neste museu." });
        }

        let totalVisits = 0;

        // 3. Generate Visits
        for (const visitor of visitors) {
            const visitCount = faker.number.int({ min: Number(minVisits), max: Number(maxVisits) });

            // Pick random unique works
            const shuffledWorks = works.sort(() => 0.5 - Math.random()).slice(0, visitCount);

            for (const work of shuffledWorks) {
                await prisma.visitorVisit.create({
                    data: {
                        visitorId: visitor.id,
                        workId: work.id,
                        xpGained: 10,
                        source: Math.random() > 0.7 ? 'QR' : 'APP', // 30% QR, 70% App navigation
                        createdAt: faker.date.recent({ days: 7 }) // Spread over last 7 days
                    }
                });
            }

            // Update Visitor XP and Last Login
            await prisma.visitor.update({
                where: { id: visitor.id },
                data: {
                    xp: { increment: visitCount * 10 },
                    updatedAt: new Date()
                }
            });

            totalVisits += visitCount;
        }

        return res.json({
            message: `Simulação concluída!`,
            details: `${visitors.length} visitantes geraram ${totalVisits} novas visitas.`
        });

    } catch (err) {
        console.error("Erro simulacao trafego", err);
        return res.status(500).json({ message: "Erro ao simular tráfego" });
    }
});

export default router;
