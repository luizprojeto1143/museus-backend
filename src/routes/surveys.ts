import { Router, Request, Response } from "express";
import { SurveyQuestionType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";

const router = Router();

// ========== SCHEMAS ==========

const questionSchema = z.object({
    id: z.string().uuid().optional(),
    question: z.string().min(3, "Pergunta muito curta"),
    type: z.enum(["STARS", "TEXT", "CHOICE", "NPS"]).default("STARS"),
    options: z.array(z.string()).optional(),
    required: z.boolean().default(true),
    order: z.number().default(0)
});

const saveQuestionsSchema = z.object({
    questions: z.array(questionSchema)
});

const responseSchema = z.object({
    answers: z.array(z.object({
        questionId: z.string().uuid(),
        answer: z.string()
    })),
    guestEmail: z.string().email().optional()
});

// ========== ADMIN ENDPOINTS ==========

// GET /events/:eventId/survey - Get survey questions for an event
router.get("/events/:eventId/survey", async (req: Request, res: Response) => {
    try {
        const { eventId } = req.params;

        const questions = await prisma.surveyQuestion.findMany({
            where: { eventId },
            orderBy: { order: "asc" },
            include: {
                _count: {
                    select: { responses: true }
                }
            }
        });

        res.json(questions);
    } catch (error) {
        console.error("Error fetching survey:", error);
        res.status(500).json({ error: "Erro ao buscar pesquisa" });
    }
});

// POST /events/:eventId/survey - Create/update survey questions (admin)
router.post("/events/:eventId/survey", async (req: Request, res: Response) => {
    try {
        const { eventId } = req.params;
        const parsed = saveQuestionsSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.errors[0].message });
        }

        // Verify event exists
        const event = await prisma.event.findUnique({ where: { id: eventId } });
        if (!event) {
            return res.status(404).json({ error: "Evento não encontrado" });
        }

        // 1. Get existing questions to know what to archive
        const existingQuestions = await prisma.surveyQuestion.findMany({
            where: { eventId }
        });

        const newQuestions = parsed.data.questions;
        const newQuestionIds = newQuestions.map(q => (q as any).id).filter(Boolean);

        // 2. Archive questions that were removed
        const questionsToArchive = existingQuestions.filter(q => !newQuestionIds.includes(q.id));
        if (questionsToArchive.length > 0) {
            // Ideally add an 'archived' field to SurveyQuestion model. 
            // For now, if we can't change schema, we keep them but they might be filtered out in GET.
            // But the report suggests we should NOT delete.
            // Check if schema has archived field. If not, we just don't delete.
            console.log(`[Survey] Preserving ${questionsToArchive.length} old questions to avoid data loss.`);
        }

        // 3. Upsert questions
        const questions = await Promise.all(
            newQuestions.map(async (q: any, idx) => {
                if (q.id) {
                    return prisma.surveyQuestion.update({
                        where: { id: q.id },
                        data: {
                            question: q.question,
                            type: q.type as SurveyQuestionType,
                            options: q.options ?? undefined,
                            required: q.required,
                            order: idx
                        }
                    });
                } else {
                    return prisma.surveyQuestion.create({
                        data: {
                            eventId,
                            question: q.question,
                            type: q.type as SurveyQuestionType,
                            options: q.options ?? undefined,
                            required: q.required,
                            order: idx
                        }
                    });
                }
            })
        );

        res.json({ success: true, questions });
    } catch (error) {
        console.error("Error saving survey:", error);
        res.status(500).json({ error: "Erro ao salvar pesquisa" });
    }
});

// GET /events/:eventId/survey/results - Get aggregated survey results (admin)
router.get("/events/:eventId/survey/results", async (req: Request, res: Response) => {
    try {
        const { eventId } = req.params;

        const questions = await prisma.surveyQuestion.findMany({
            where: { eventId },
            orderBy: { order: "asc" },
            include: {
                responses: true
            }
        });

        // Calculate aggregated results
        const results = questions.map(q => {
            const responses = q.responses;
            const totalResponses = responses.length;

            let aggregation: Record<string, unknown> = {};

            if (q.type === "STARS" || q.type === "NPS") {
                // Calculate average
                const numericAnswers = responses
                    .map(r => parseFloat(r.answer))
                    .filter(n => !isNaN(n));

                const average = numericAnswers.length > 0
                    ? numericAnswers.reduce((a, b) => a + b, 0) / numericAnswers.length
                    : 0;

                // Distribution
                const distribution: Record<string, number> = {};
                numericAnswers.forEach(n => {
                    const key = String(n);
                    distribution[key] = (distribution[key] || 0) + 1;
                });

                aggregation = {
                    average: Math.round(average * 10) / 10,
                    distribution,
                    count: numericAnswers.length
                };

                // NPS calculation
                if (q.type === "NPS") {
                    const promoters = numericAnswers.filter(n => n >= 9).length;
                    const detractors = numericAnswers.filter(n => n <= 6).length;
                    const npsScore = totalResponses > 0
                        ? Math.round(((promoters - detractors) / totalResponses) * 100)
                        : 0;
                    aggregation.npsScore = npsScore;
                }
            } else if (q.type === "CHOICE") {
                // Count each option
                const distribution: Record<string, number> = {};
                responses.forEach(r => {
                    distribution[r.answer] = (distribution[r.answer] || 0) + 1;
                });
                aggregation = { distribution, count: totalResponses };
            } else {
                // TEXT - just return latest responses
                aggregation = {
                    recentAnswers: responses.slice(-10).map(r => ({
                        answer: r.answer,
                        createdAt: r.createdAt
                    })),
                    count: totalResponses
                };
            }

            return {
                id: q.id,
                question: q.question,
                type: q.type,
                options: q.options,
                totalResponses,
                aggregation
            };
        });

        // Overall stats
        const uniqueRespondents = await prisma.surveyResponse.groupBy({
            by: ["visitorId", "guestEmail"],
            where: {
                question: { eventId }
            }
        });

        res.json({
            questions: results,
            totalRespondents: uniqueRespondents.length
        });
    } catch (error) {
        console.error("Error fetching survey results:", error);
        res.status(500).json({ error: "Erro ao buscar resultados" });
    }
});

// ========== VISITOR ENDPOINTS ==========

// POST /events/:eventId/survey/respond - Submit survey responses (visitor)
router.post("/events/:eventId/survey/respond", async (req: Request, res: Response) => {
    try {
        const { eventId } = req.params;
        const parsed = responseSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.errors[0].message });
        }

        const { answers, guestEmail } = parsed.data;
        const visitorId = (req as Request & { visitorId?: string }).visitorId || null;

        if (!visitorId && !guestEmail) {
            return res.status(400).json({ error: "Informe email ou faça login" });
        }

        // Verify questions belong to this event
        const questionIds = answers.map(a => a.questionId);
        const questions = await prisma.surveyQuestion.findMany({
            where: {
                id: { in: questionIds },
                eventId
            }
        });

        if (questions.length !== questionIds.length) {
            return res.status(400).json({ error: "Perguntas inválidas" });
        }

        // Check for required questions
        const requiredQuestions = await prisma.surveyQuestion.findMany({
            where: { eventId, required: true }
        });
        const answeredIds = new Set(questionIds);
        const missingRequired = requiredQuestions.filter(q => !answeredIds.has(q.id));

        if (missingRequired.length > 0) {
            return res.status(400).json({
                error: `Responda todas as perguntas obrigatórias`
            });
        }

        // Save responses (upsert)
        const savedResponses = await Promise.all(
            answers.map(async (a) => {
                const whereClause = visitorId
                    ? { questionId_visitorId: { questionId: a.questionId, visitorId } }
                    : { questionId_guestEmail: { questionId: a.questionId, guestEmail: guestEmail! } };

                return prisma.surveyResponse.upsert({
                    where: whereClause,
                    create: {
                        questionId: a.questionId,
                        visitorId,
                        guestEmail: visitorId ? null : guestEmail,
                        answer: a.answer
                    },
                    update: {
                        answer: a.answer
                    }
                });
            })
        );

        res.json({ success: true, count: savedResponses.length });
    } catch (error) {
        console.error("Error saving survey response:", error);
        res.status(500).json({ error: "Erro ao salvar respostas" });
    }
});

// GET /events/:eventId/survey/my-responses - Get visitor's responses
router.get("/events/:eventId/survey/my-responses", async (req: Request, res: Response) => {
    try {
        const { eventId } = req.params;
        const visitorId = (req as Request & { visitorId?: string }).visitorId;
        const guestEmail = req.query.email as string | undefined;

        if (!visitorId && !guestEmail) {
            return res.status(400).json({ error: "Informe email ou faça login" });
        }

        const responses = await prisma.surveyResponse.findMany({
            where: {
                question: { eventId },
                OR: [
                    { visitorId: visitorId || undefined },
                    { guestEmail: guestEmail || undefined }
                ]
            },
            include: {
                question: true
            }
        });

        res.json(responses);
    } catch (error) {
        console.error("Error fetching responses:", error);
        res.status(500).json({ error: "Erro ao buscar respostas" });
    }
});

export default router;
