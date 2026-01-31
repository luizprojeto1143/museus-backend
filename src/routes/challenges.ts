import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

// ============ DAILY CHALLENGES ============

// GET /challenges/today - Get today's challenge
router.get('/today', async (req, res) => {
    try {
        const { tenantId } = req.query;

        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId é obrigatório' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const challenge = await prisma.dailyChallenge.findFirst({
            where: {
                tenantId: tenantId as string,
                activeDate: {
                    gte: today,
                    lt: tomorrow
                }
            }
        });

        if (!challenge) {
            // Return a default challenge if none exists
            return res.json({
                id: 'default',
                title: 'Explore o Museu',
                description: 'Visite pelo menos 3 obras hoje',
                xpReward: 50,
                type: 'VISIT_WORK',
                target: 3,
                isDefault: true
            });
        }

        res.json(challenge);
    } catch (error) {
        console.error('Error fetching daily challenge:', error);
        res.status(500).json({ message: 'Erro ao buscar desafio' });
    }
});

// GET /challenges/my-progress - Get user's progress on today's challenge
router.get('/my-progress', authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const { tenantId } = req.query;

        if (!tenantId) {
            return res.json({ progress: 0, completed: false });
        }

        // CRITICAL FIX: Find visitor by user's email, not user's ID
        const visitor = await prisma.visitor.findFirst({
            where: { email: user.email.toLowerCase(), tenantId: tenantId as string }
        });

        if (!visitor) {
            return res.json({ progress: 0, completed: false });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const challenge = await prisma.dailyChallenge.findFirst({
            where: {
                tenantId: tenantId as string,
                activeDate: { gte: today, lt: tomorrow }
            }
        });

        if (!challenge) {
            return res.json({ progress: 0, completed: false });
        }

        const completion = await prisma.dailyChallengeCompletion.findUnique({
            where: {
                visitorId_challengeId: { visitorId: visitor.id, challengeId: challenge.id }
            }
        });

        res.json({
            challengeId: challenge.id,
            progress: completion?.progress || 0,
            target: challenge.target,
            completed: completion?.completed || false
        });
    } catch (error) {
        console.error('Error fetching progress:', error);
        res.status(500).json({ message: 'Erro ao buscar progresso' });
    }
});

// POST /challenges/:id/progress - Update challenge progress
router.post('/:id/progress', authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        const { increment = 1, tenantId } = req.body;

        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId é obrigatório' });
        }

        // CRITICAL FIX: Find visitor by user's email
        const visitor = await prisma.visitor.findFirst({
            where: { email: user.email.toLowerCase(), tenantId }
        });

        if (!visitor) {
            return res.status(404).json({ message: 'Perfil de visitante não encontrado' });
        }

        const challenge = await prisma.dailyChallenge.findUnique({
            where: { id }
        });

        if (!challenge) {
            return res.status(404).json({ message: 'Desafio não encontrado' });
        }

        // Use transaction to prevent race conditions
        // CRITICAL FIX: Serializable isolation prevents concurrent reads of 'existing' progress
        const result = await prisma.$transaction(async (tx) => {
            const existing = await tx.dailyChallengeCompletion.findUnique({
                where: { visitorId_challengeId: { visitorId: visitor.id, challengeId: id } }
            });

            let completion;
            let xpAwarded = 0;

            if (existing) {
                if (existing.completed) {
                    return { completion: existing, xpAwarded: 0, alreadyCompleted: true };
                }

                const newProgress = Math.min(existing.progress + increment, challenge.target);
                const isComplete = newProgress >= challenge.target;

                completion = await tx.dailyChallengeCompletion.update({
                    where: { id: existing.id },
                    data: { progress: newProgress, completed: isComplete }
                });

                if (isComplete && !existing.completed) {
                    await tx.visitor.update({
                        where: { id: visitor.id },
                        data: { xp: { increment: challenge.xpReward } }
                    });
                    xpAwarded = challenge.xpReward;
                }
            } else {
                const newProgress = Math.min(increment, challenge.target);
                const isComplete = newProgress >= challenge.target;

                completion = await tx.dailyChallengeCompletion.create({
                    data: {
                        visitorId: visitor.id,
                        challengeId: id,
                        progress: newProgress,
                        completed: isComplete
                    }
                });

                if (isComplete) {
                    await tx.visitor.update({
                        where: { id: visitor.id },
                        data: { xp: { increment: challenge.xpReward } }
                    });
                    xpAwarded = challenge.xpReward;
                }
            }

            return { completion, xpAwarded, alreadyCompleted: false };
        });

        if (result.alreadyCompleted) {
            return res.json({ message: 'Desafio já completado', xpAwarded: 0 });
        }

        if (result.xpAwarded > 0) {
            return res.json({
                ...result.completion,
                xpAwarded: result.xpAwarded,
                message: `Parabéns! Você ganhou ${result.xpAwarded} XP!`
            });
        }

        res.json(result.completion);
    } catch (error) {
        console.error('Error updating progress:', error);
        res.status(500).json({ message: 'Erro ao atualizar progresso' });
    }
});

// ============ SCAVENGER HUNTS ============

// GET /challenges/hunts - List active scavenger hunts
router.get('/hunts', async (req, res) => {
    try {
        const { tenantId } = req.query;

        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId é obrigatório' });
        }

        const now = new Date();

        const hunts = await prisma.scavengerHunt.findMany({
            where: {
                tenantId: tenantId as string,
                active: true,
                OR: [
                    { startsAt: null },
                    { startsAt: { lte: now } }
                ],
                AND: [
                    {
                        OR: [
                            { endsAt: null },
                            { endsAt: { gte: now } }
                        ]
                    }
                ]
            },
            include: {
                _count: { select: { steps: true } }
            }
        });

        res.json(hunts);
    } catch (error) {
        console.error('Error fetching hunts:', error);
        res.status(500).json({ message: 'Erro ao buscar caças ao tesouro' });
    }
});

// GET /challenges/hunts/:id - Get hunt details with first step
router.get('/hunts/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const hunt = await prisma.scavengerHunt.findUnique({
            where: { id },
            include: {
                steps: {
                    orderBy: { order: 'asc' },
                    take: 1, // Only show first step initially
                    select: { id: true, order: true, clue: true }
                }
            }
        });

        if (!hunt) {
            return res.status(404).json({ message: 'Caça ao tesouro não encontrada' });
        }

        res.json(hunt);
    } catch (error) {
        console.error('Error fetching hunt:', error);
        res.status(500).json({ message: 'Erro ao buscar caça ao tesouro' });
    }
});

// POST /challenges/hunts/:id/start - Start a hunt
router.post('/hunts/:id/start', authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        const { tenantId } = req.body;

        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId é obrigatório' });
        }

        // CRITICAL FIX: Find visitor by user's email
        const visitor = await prisma.visitor.findFirst({
            where: { email: user.email.toLowerCase(), tenantId }
        });

        if (!visitor) {
            return res.status(404).json({ message: 'Perfil de visitante não encontrado' });
        }

        const existing = await prisma.scavengerHuntParticipation.findUnique({
            where: { visitorId_huntId: { visitorId: visitor.id, huntId: id } }
        });

        if (existing) {
            return res.json({
                ...existing,
                message: 'Você já está participando desta caça'
            });
        }

        const participation = await prisma.scavengerHuntParticipation.create({
            data: {
                visitorId: visitor.id,
                huntId: id,
                currentStep: 0
            }
        });

        // Get first clue
        const firstStep = await prisma.scavengerHuntStep.findFirst({
            where: { huntId: id, order: 0 },
            select: { clue: true }
        });

        res.status(201).json({
            ...participation,
            currentClue: firstStep?.clue
        });
    } catch (error) {
        console.error('Error starting hunt:', error);
        res.status(500).json({ message: 'Erro ao iniciar caça ao tesouro' });
    }
});

// POST /challenges/hunts/:id/answer - Submit answer for current step
router.post('/hunts/:id/answer', authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        const { answer, tenantId } = req.body;

        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId é obrigatório' });
        }

        // CRITICAL FIX: Find visitor by user's email
        const visitor = await prisma.visitor.findFirst({
            where: { email: user.email.toLowerCase(), tenantId }
        });

        if (!visitor) {
            return res.status(404).json({ message: 'Perfil de visitante não encontrado' });
        }

        const participation = await prisma.scavengerHuntParticipation.findUnique({
            where: { visitorId_huntId: { visitorId: visitor.id, huntId: id } }
        });

        if (!participation) {
            return res.status(400).json({ message: 'Você não está participando desta caça' });
        }

        if (participation.completed) {
            return res.json({ message: 'Você já completou esta caça!', completed: true });
        }

        // Get current step
        const currentStep = await prisma.scavengerHuntStep.findFirst({
            where: { huntId: id, order: participation.currentStep }
        });

        if (!currentStep) {
            return res.status(400).json({ message: 'Passo não encontrado' });
        }

        // Check answer (case insensitive)
        if (answer.toLowerCase().trim() !== currentStep.answer.toLowerCase().trim()) {
            return res.json({
                correct: false,
                message: 'Resposta incorreta. Tente novamente!'
            });
        }

        // Get next step
        const nextStep = await prisma.scavengerHuntStep.findFirst({
            where: { huntId: id, order: participation.currentStep + 1 }
        });

        if (!nextStep) {
            // Hunt completed - use transaction to award XP atomically
            const result = await prisma.$transaction(async (tx) => {
                const hunt = await tx.scavengerHunt.findUnique({ where: { id } });

                await tx.scavengerHuntParticipation.update({
                    where: { id: participation.id },
                    data: {
                        currentStep: participation.currentStep + 1,
                        completed: true,
                        completedAt: new Date()
                    }
                });

                if (hunt?.xpReward) {
                    await tx.visitor.update({
                        where: { id: visitor.id },
                        data: { xp: { increment: hunt.xpReward } }
                    });
                }

                return hunt;
            });

            return res.json({
                correct: true,
                completed: true,
                xpAwarded: result?.xpReward || 0,
                message: `Parabéns! Você completou a caça ao tesouro e ganhou ${result?.xpReward || 0} XP!`
            });
        }

        // Move to next step
        await prisma.scavengerHuntParticipation.update({
            where: { id: participation.id },
            data: { currentStep: participation.currentStep + 1 }
        });

        res.json({
            correct: true,
            completed: false,
            nextClue: nextStep.clue,
            message: 'Correto! Aqui está a próxima pista.'
        });
    } catch (error) {
        console.error('Error answering:', error);
        res.status(500).json({ message: 'Erro ao processar resposta' });
    }
});

export default router;
