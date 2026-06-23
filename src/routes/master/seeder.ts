import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { Role } from "@prisma/client";
import { fakerPT_BR as faker } from '@faker-js/faker';
import crypto from "crypto";

const router = Router();

// BLOCK SEEDER IN PRODUCTION
router.use((req, res, next) => {
    if (process.env.NODE_ENV === "production") {
        return res.status(403).json({ message: "Operação não permitida em ambiente de produção" });
    }
    next();
});

// Generate Fake Visitors
router.post("/generate", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
    try {
        const { tenantId, count = 10 } = req.body;
        const finalTenantId = req.user!.role === Role.MASTER ? tenantId : req.user!.tenantId;
        if (!finalTenantId) return res.status(400).json({ message: "Tenant ID required" });

        const amount = Math.min(Math.max(Number(count), 1), 50); // Min 1, Max 50 per batch

        const createdVisitors = [];

        // Get some works to create baseline visits
        const works = await prisma.work.findMany({
            where: { tenantId: finalTenantId },
            select: { id: true },
            take: 10
        });

        for (let i = 0; i < amount; i++) {
            const sex = faker.person.sexType();
            const firstName = faker.person.firstName(sex);
            const lastName = faker.person.lastName();
            const name = `${firstName} ${lastName}`;
            const email = faker.internet.email({ firstName, lastName, provider: 'gmail.com' }).toLowerCase();
            const createdAt = faker.date.recent({ days: 30 });

            const visitor = await prisma.visitor.create({
                data: {
                    name,
                    email,
                    tenantId: finalTenantId,
                    isFake: true,
                    age: faker.number.int({ min: 12, max: 75 }),
                    xp: 0,
                    photoUrl: faker.image.avatar(),
                    createdAt: createdAt,
                    updatedAt: createdAt
                }
            });

            // Auto-generate 1-3 initial visits so they don't look empty
            if (works.length > 0) {
                const initialVisits = faker.number.int({ min: 1, max: 3 });
                const shuffled = [...works].sort(() => 0.5 - Math.random()).slice(0, initialVisits);
                let totalXp = 0;
                let lastDate = createdAt;

                for (const w of shuffled) {
                    const xp = faker.number.int({ min: 10, max: 30 });
                    const visitDate = faker.date.between({ from: createdAt, to: new Date() });
                    if (visitDate > lastDate) lastDate = visitDate;

                    await prisma.visitorVisit.create({
                        data: {
                            visitorId: visitor.id,
                            workId: w.id,
                            xpGained: xp,
                            source: 'AUTO',
                            createdAt: visitDate
                        }
                    });
                    await (prisma.passportStamp as any).create({
                        data: { 
                            visitorId: visitor.id, 
                            workId: w.id, 
                            raridade: "COMMON",
                            numeroCaptura: 0,
                            xpGanho: 50,
                            stampedAt: visitDate 
                        }
                    }).catch(() => { });
                    totalXp += xp;
                }

                await prisma.visitor.update({
                    where: { id: visitor.id },
                    data: {
                        xp: totalXp,
                        updatedAt: lastDate
                    }
                });
            }

            createdVisitors.push(visitor);
        }

        return res.json({ message: `Gerados ${createdVisitors.length} visitantes com histórico inicial`, visitors: createdVisitors });
    } catch (err) {
        console.error("Erro ao gerar visitantes", err);
        return res.status(500).json({ message: "Erro ao gerar visitantes" });
    }
});

// Delete all Fake Visitors for Tenant
router.delete("/bulk", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
    try {
        const { tenantId } = req.body;
        const finalTenantId = req.user!.role === Role.MASTER ? tenantId : req.user!.tenantId;
        if (!finalTenantId) return res.status(400).json({ message: "Tenant ID required" });

        // Delete related data first (for visitors that are isFake)
        const fakeVisitors = await prisma.visitor.findMany({
            where: { tenantId: finalTenantId, isFake: true },
            select: { id: true }
        });
        const fakeIds = fakeVisitors.map(v => v.id);

        if (fakeIds.length > 0) {
            // Clean ALL tables that reference Visitor via FK
            await prisma.visitorVisit.deleteMany({ where: { visitorId: { in: fakeIds } } });
            await prisma.passportStamp.deleteMany({ where: { visitorId: { in: fakeIds } } });
            await prisma.visitorAchievement.deleteMany({ where: { visitorId: { in: fakeIds } } });
            await prisma.guestbookEntry.deleteMany({ where: { visitorId: { in: fakeIds } } });
            await prisma.review.deleteMany({ where: { visitorId: { in: fakeIds } } });
            await prisma.eventAttendance.deleteMany({ where: { visitorId: { in: fakeIds } } });
            await prisma.favorite.deleteMany({ where: { visitorId: { in: fakeIds } } });
            await prisma.certificate.deleteMany({ where: { visitorId: { in: fakeIds } } });
            await prisma.notificationPreference.deleteMany({ where: { visitorId: { in: fakeIds } } });
            await prisma.dailyChallengeCompletion.deleteMany({ where: { visitorId: { in: fakeIds } } });
            await prisma.scavengerHuntParticipation.deleteMany({ where: { visitorId: { in: fakeIds } } });
            await prisma.deviceToken.deleteMany({ where: { visitorId: { in: fakeIds } } });
            // Orders have OrderItems, delete items first
            const fakeOrders = await prisma.order.findMany({ where: { visitorId: { in: fakeIds } }, select: { id: true } });
            if (fakeOrders.length > 0) {
                await prisma.orderItem.deleteMany({ where: { orderId: { in: fakeOrders.map(o => o.id) } } });
                await prisma.order.deleteMany({ where: { visitorId: { in: fakeIds } } });
            }
            // Registrations
            await prisma.registration.deleteMany({ where: { visitorId: { in: fakeIds } } });
        }

        const deleted = await prisma.visitor.deleteMany({
            where: { tenantId: finalTenantId, isFake: true }
        });

        return res.json({ message: `Removidos ${deleted.count} visitantes falsos e todos seus dados relacionados` });
    } catch (err) {
        console.error("Erro apagar visitantes", err);
        return res.status(500).json({ message: "Erro ao apagar visitantes" });
    }
});

// Simulate Interaction (Visit / Comment) — kept for single interactions
router.post("/interact", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
    try {
        const { visitorId, type, content } = req.body;

        const visitor = await prisma.visitor.findUnique({ where: { id: visitorId } });
        if (!visitor || !visitor.isFake) {
            return res.status(400).json({ message: "Visitante inválido ou real" });
        }

        // Validate that admin only interacts with their own tenant's visitors
        if (req.user!.role !== Role.MASTER && visitor.tenantId !== req.user!.tenantId) {
            return res.status(403).json({ message: "Sem permissão para este visitante" });
        }

        if (type === 'visit') {
            const work = await prisma.work.findFirst({
                where: { tenantId: visitor.tenantId },
                orderBy: { id: 'asc' },
                skip: Math.floor(Math.random() * 5)
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
                await prisma.visitor.update({
                    where: { id: visitor.id },
                    data: { xp: { increment: 10 } }
                });
                return res.json({ message: `Registrada visita do visitante focado à obra: ${work.title}` });
            }
            return res.status(400).json({ message: "Museu sem obras para simular visita" });

        } else if (type === 'guestbook') {
            if (!content) return res.status(400).json({ message: "Conteúdo obrigatório para guestbook" });
            const entry = await prisma.guestbookEntry.create({
                data: {
                    visitorId: visitor.id,
                    tenantId: visitor.tenantId,
                    message: content
                }
            });
            return res.json({ message: "Mensagem criada no mural", entry });
        }

        return res.status(400).json({ message: "Tipo de interação não suportado" });
    } catch (err) {
        console.error("Erro interact", err);
        return res.status(500).json({ message: "Erro na interação" });
    }
});

const guestbookMessages = [
    "Lindo lugar! Adorei a exposição principal.",
    "Parabéns pela organização e acessibilidade.",
    "Uma experiência única de imersão histórica.",
    "Voltarei com meus alunos, infraestrutura sensacional.",
    "Muito prático usar o guia do museu pelo celular."
];

const reviewComments = [
    "Obra de arte fascinante.",
    "Excelente preservação e curadoria.",
    "Achei a descrição muito instrutiva.",
    "Simplesmente espetacular. Vale a visita só por esta obra.",
    "Interessante, mas esperava algo mais impactante.",
    "A iluminação destaca muito bem os detalhes da obra.",
    "Peça icônica do acervo. Imperdível!",
    "Muito bonita, minha favorita da visita.",
    "Obra que te faz refletir. Muito poderosa.",
];

// ===== COMPLETE TRAFFIC SIMULATION =====
router.post("/simulate-traffic", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
    try {
        const { tenantId, visitorCount = 5, minVisits = 1, maxVisits = 5 } = req.body;
        const finalTenantId = req.user!.role === Role.MASTER ? tenantId : req.user!.tenantId;
        if (!finalTenantId) return res.status(400).json({ message: "Tenant ID required" });

        // 1. Get Fake Visitors (Randomize selection to avoid only hitting oldest)
        const allVisitors = await prisma.visitor.findMany({
            where: { tenantId: finalTenantId, isFake: true },
            select: { id: true }
        });

        if (allVisitors.length === 0) {
            return res.status(400).json({ message: "Nenhum visitante falso encontrado. Gere visitantes primeiro." });
        }

        const selectedIds = [...allVisitors]
            .sort(() => 0.5 - Math.random())
            .slice(0, Number(visitorCount) || 20)
            .map(v => v.id);

        const visitors = await prisma.visitor.findMany({
            where: { id: { in: selectedIds } }
        });

        // 2. Get Works
        const works = await prisma.work.findMany({
            where: { tenantId: finalTenantId },
            select: { id: true, title: true }
        });

        if (works.length === 0) {
            return res.status(400).json({ message: "Nenhuma obra encontrada neste museu." });
        }

        // 3. Get Achievements (if any)
        const achievements = await prisma.achievement.findMany({
            where: { tenantId: finalTenantId, active: true },
            select: { id: true, xpReward: true }
        });

        const trails = await prisma.trail.findMany({
            where: { tenantId: finalTenantId, active: true },
            select: { id: true }
        });

        let totalVisits = 0;
        let totalStamps = 0;
        let totalAchievements = 0;
        let totalGuestbook = 0;
        let totalReviews = 0;

        // 4. Generate Complete Data for Each Visitor
        for (const visitor of visitors) {
            const visitCount = faker.number.int({ min: Number(minVisits), max: Number(maxVisits) });
            let visitorXpGained = 0;

            // Shuffle works and pick random ones
            const shuffledWorks = [...works].sort(() => 0.5 - Math.random()).slice(0, visitCount);

            // --- VISITS + STAMPS ---
            for (const work of shuffledWorks) {
                const xp = faker.number.int({ min: 5, max: 25 });
                const visitDate = faker.date.recent({ days: 14 });

                // Create visit
                await prisma.visitorVisit.create({
                    data: {
                        visitorId: visitor.id,
                        workId: work.id,
                        xpGained: xp,
                        source: Math.random() > 0.7 ? 'QR' : 'APP',
                        createdAt: visitDate
                    }
                });
                totalVisits++;
                visitorXpGained += xp;

                // Create passport stamp (skip if already exists)
                try {
                    await (prisma.passportStamp as any).create({
                        data: {
                            visitorId: visitor.id,
                            workId: work.id,
                            raridade: "COMMON",
                            numeroCaptura: 0,
                            xpGanho: 50,
                            stampedAt: visitDate
                        }
                    });
                    totalStamps++;
                } catch {
                    // Duplicate stamp, skip
                }

                // Create review (~40% chance per work visited)
                if (Math.random() < 0.4) {
                    try {
                        await prisma.review.create({
                            data: {
                                visitorId: visitor.id,
                                workId: work.id,
                                rating: faker.number.int({ min: 3, max: 5 }),
                                comment: reviewComments[Math.floor(Math.random() * reviewComments.length)],
                                approved: true,
                                createdAt: visitDate
                            }
                        });
                        totalReviews++;
                    } catch {
                        // Duplicate review (unique constraint), skip
                    }
                }
            }

            // --- ACHIEVEMENTS (~60% chance per achievement) ---
            if (achievements.length > 0) {
                const numAchievements = faker.number.int({ min: 0, max: Math.min(achievements.length, 3) });
                const shuffledAch = [...achievements].sort(() => 0.5 - Math.random()).slice(0, numAchievements);

                for (const ach of shuffledAch) {
                    try {
                        await prisma.visitorAchievement.create({
                            data: {
                                visitorId: visitor.id,
                                achievementId: ach.id,
                                unlockedAt: faker.date.recent({ days: 14 })
                            }
                        });
                        visitorXpGained += ach.xpReward;
                        totalAchievements++;
                    } catch {
                        // Duplicate achievement, skip
                    }
                }
            }

            // --- GUESTBOOK (~30% chance) ---
            if (Math.random() < 0.3) {
                await prisma.guestbookEntry.create({
                    data: {
                        visitorId: visitor.id,
                        tenantId: finalTenantId,
                        message: guestbookMessages[Math.floor(Math.random() * guestbookMessages.length)],
                        createdAt: faker.date.recent({ days: 14 })
                    }
                });
                totalGuestbook++;
            }

            // --- TRAILS (~20% chance) ---
            if (trails.length > 0 && Math.random() < 0.2) {
                const trail = trails[Math.floor(Math.random() * trails.length)];
                await prisma.visitorVisit.create({
                    data: {
                        visitorId: visitor.id,
                        trailId: trail.id,
                        xpGained: 50,
                        source: 'AUTO',
                        createdAt: faker.date.recent({ days: 14 })
                    }
                });
                visitorXpGained += 50;
            }

            // --- UPDATE VISITOR XP ---
            await prisma.visitor.update({
                where: { id: visitor.id },
                data: {
                    xp: { increment: visitorXpGained },
                    updatedAt: new Date()
                }
            });
        }

        const details = [
            `👥 ${visitors.length} visitantes processados`,
            `🎨 ${totalVisits} visitas a obras`,
            `🔖 ${totalStamps} selos no passaporte`,
            `🏆 ${totalAchievements} conquistas`,
            `📝 ${totalGuestbook} guestbook`,
            `⭐ ${totalReviews} reviews`
        ].join(' | ');

        return res.json({
            message: `Simulação completa!`,
            details,
            stats: { visitors: visitors.length, visits: totalVisits, stamps: totalStamps, achievements: totalAchievements, guestbook: totalGuestbook, reviews: totalReviews }
        });

    } catch (err) {
        console.error("Erro simulacao trafego", err);
        return res.status(500).json({ message: "Erro ao simular tráfego" });
    }
});

export default router;
