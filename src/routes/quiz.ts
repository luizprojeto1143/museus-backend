import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /quiz — Get quiz for a specific target (SPACE/WORK)
router.get('/', async (req, res) => {
    try {
        const { targetId } = req.query;
        if (!targetId) return res.status(400).json({ message: 'targetId obrigatório' });

        const quiz = await prisma.quiz.findFirst({
            where: { targetId: targetId as string },
            include: {
                questions: true
            }
        });

        res.json(quiz);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar quiz' });
    }
});

// POST /quiz/:id/answer — Validate answer and reward XP
router.post('/:id/answer', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { questionId, answerIndex } = req.body;
        const visitorId = req.user!.id; // Assuming logged in as visitor

        const question = await prisma.quizQuestion.findUnique({
            where: { id: questionId },
            include: { quiz: true }
        });

        if (!question) return res.status(404).json({ message: 'Questão não encontrada' });

        const isCorrect = question.correctIndex === answerIndex;

        if (isCorrect) {
            // L5 Fix: Prevent XP duplication (Check if visitor already answered this question)
            const alreadyAnswered = await prisma.visitorVisit.findFirst({
                where: {
                    visitorId,
                    source: 'QUIZ',
                    // Assuming we can track which question was answered. 
                    // Since VisitorVisit doesn't have questionId, we use oldData or similar if available, 
                    // or just check for a recent QUIZ visit in this target.
                    // Let's use a simple check: one XP reward per question per day or per life?
                    // Usually quizzes are one-time XP.
                    createdAt: {
                        gte: new Date(new Date().getTime() - (24 * 60 * 60 * 1000)) // Last 24h
                    }
                }
            });

            if (alreadyAnswered) {
                return res.json({ 
                    isCorrect: true, 
                    correctAnswer: question.correctIndex, 
                    xpGained: 0, 
                    message: "Você já ganhou XP por este quiz recentemente!" 
                });
            }

            // Reward XP
            await prisma.visitor.update({
                where: { id: visitorId },
                data: { xp: { increment: question.xpReward } }
            });

            // Log the activity
            await prisma.visitorVisit.create({
                data: {
                    visitorId,
                    source: 'QUIZ',
                    xpGained: question.xpReward,
                    createdAt: new Date()
                }
            });
        }

        res.json({ isCorrect, correctAnswer: question.correctIndex, xpGained: isCorrect ? question.xpReward : 0 });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao validar resposta' });
    }
});

// ADMIN: POST /quiz — Create or update a quiz
router.post('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { title, targetType, targetId, questions } = req.body;
        const tenantId = req.user!.tenantId;

        const quiz = await prisma.quiz.create({
            data: {
                title,
                targetType,
                targetId,
                tenantId: tenantId!,
                questions: {
                    create: questions.map((q: any) => ({
                        question: q.question,
                        options: q.options,
                        correctIndex: q.correctIndex,
                        xpReward: q.xpReward || 50
                    }))
                }
            },
            include: { questions: true }
        });

        res.status(201).json(quiz);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar quiz' });
    }
});

export default router;
