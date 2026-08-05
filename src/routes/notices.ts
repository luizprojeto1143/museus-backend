import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role, NoticeStatus } from "@prisma/client";
import { z } from "zod";

const router = Router();

// ========== PUBLIC ENDPOINTS ==========

// Lista editais públicos (abertos ou publicados)
router.get("/public", async (req, res) => {
    try {
        const { tenantId, status } = req.query;

        const where: any = {
            status: { in: ["PUBLISHED", "INSCRIPTIONS_OPEN", "INSCRIPTIONS_CLOSED", "RESULTS_PUBLISHED"] }
        };

        if (tenantId) where.tenantId = tenantId;
        if (status) where.status = status;

        const notices = await prisma.publicNotice.findMany({
            where,
            orderBy: { inscriptionEnd: "desc" },
            include: {
                tenant: { select: { id: true, name: true, slug: true, logoUrl: true } },
                _count: { select: { culturalProjects: true } }
            }
        });

        return res.json(notices);
    } catch (err) {
        console.error("Erro ao listar editais públicos", err);
        return res.status(500).json({ message: "Erro ao listar editais" });
    }
});

// Detalhes do edital (público)
router.get("/public/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const notice = await prisma.publicNotice.findUnique({
            where: { id },
            include: {
                tenant: { select: { id: true, name: true, slug: true, logoUrl: true } },
                _count: { select: { culturalProjects: true } }
            }
        });

        if (!notice) {
            return res.status(404).json({ message: "Edital não encontrado" });
        }

        // Só permite ver se não for rascunho
        if (notice.status === "DRAFT") {
            return res.status(404).json({ message: "Edital não encontrado" });
        }

        return res.json(notice);
    } catch (err) {
        console.error("Erro ao buscar edital", err);
        return res.status(500).json({ message: "Erro ao buscar edital" });
    }
});

// Resultados do edital (Ranking público)
router.get("/public/:id/results", async (req, res) => {
    try {
        const { id } = req.params;

        const notice = await prisma.publicNotice.findUnique({
            where: { id },
            select: { status: true, title: true, showScoresInResults: true }
        });

        if (!notice || notice.status !== "RESULTS_PUBLISHED") {
            return res.status(404).json({ message: "Resultados ainda não estão disponíveis para este edital" });
        }

        const projects = await prisma.culturalProject.findMany({
            where: {
                noticeId: id,
                status: "APPROVED" // Apenas aprovados entram no ranking oficial
            },
            orderBy: {
                finalScore: "desc"
            },
            include: {
                user: { select: { name: true } }
            }
        });

        return res.json({
            noticeTitle: notice.title,
            showScores: notice.showScoresInResults,
            projects: projects.map(p => ({
                id: p.id,
                title: p.title,
                proponentName: p.user?.name || "Desconhecido",
                finalScore: notice.showScoresInResults ? p.finalScore : null,
                approvedBudget: p.approvedBudget,
                culturalCategory: p.culturalCategory
            }))
        });
    } catch (err) {
        console.error("Erro ao buscar resultados do edital", err);
        return res.status(500).json({ message: "Erro ao buscar resultados" });
    }
});

// Transparência pública do ciclo do edital
router.get("/public/:id/transparency", async (req, res) => {
    try {
        const { id } = req.params;

        const notice = await prisma.publicNotice.findUnique({
            where: { id },
            include: {
                tenant: { select: { id: true, name: true, slug: true, logoUrl: true } },
                culturalProjects: {
                    orderBy: [{ finalScore: "desc" }, { createdAt: "asc" }],
                    include: {
                        user: { select: { name: true } },
                        appeals: {
                            select: {
                                id: true,
                                type: true,
                                status: true,
                                reason: true,
                                requestedAdjustment: true,
                                response: true,
                                counterResponse: true,
                                reviewedAt: true,
                                createdAt: true
                            },
                            orderBy: { createdAt: "asc" }
                        },
                        terms: {
                            where: { status: "SIGNED" },
                            select: {
                                id: true,
                                title: true,
                                documentUrl: true,
                                signedDocumentUrl: true,
                                signedAt: true
                            },
                            orderBy: { signedAt: "desc" }
                        },
                        accountabilities: {
                            where: { status: { in: ["APPROVED", "UNDER_REVIEW", "ADJUSTMENTS_REQUIRED"] } },
                            select: {
                                id: true,
                                status: true,
                                periodStart: true,
                                periodEnd: true,
                                executionSummary: true,
                                audienceReached: true,
                                amountSpent: true,
                                submittedAt: true,
                                reviewedAt: true,
                                reviewNotes: true
                            },
                            orderBy: { createdAt: "desc" }
                        }
                    }
                }
            }
        });

        if (!notice || notice.status === "DRAFT") {
            return res.status(404).json({ message: "Edital não encontrado" });
        }

        if (!["RESULTS_PUBLISHED", "FINISHED"].includes(notice.status)) {
            return res.status(404).json({ message: "Transparência disponível após publicação dos resultados" });
        }

        const projects = notice.culturalProjects.map(project => ({
            id: project.id,
            title: project.title,
            proponentName: project.user?.name || "Não informado",
            status: project.status,
            culturalCategory: project.culturalCategory,
            targetRegion: project.targetRegion,
            requestedBudget: project.requestedBudget,
            approvedBudget: project.approvedBudget,
            expectedAudience: project.expectedAudience,
            actualAudience: project.actualAudience,
            finalScore: notice.showScoresInResults ? project.finalScore : null,
            reviewedAt: project.reviewedAt,
            appeals: project.appeals,
            signedTerms: project.terms,
            accountabilities: project.accountabilities
        }));

        const totals = projects.reduce((acc, project) => {
            acc.projects += 1;
            if (project.status === "APPROVED" || project.status === "IN_EXECUTION" || project.status === "COMPLETED") acc.approved += 1;
            acc.requestedBudget += Number(project.requestedBudget || 0);
            acc.approvedBudget += Number(project.approvedBudget || 0);
            acc.audience += Number(project.actualAudience || project.expectedAudience || 0);
            acc.appeals += project.appeals.length;
            acc.signedTerms += project.signedTerms.length;
            acc.accountabilities += project.accountabilities.length;
            return acc;
        }, {
            projects: 0,
            approved: 0,
            requestedBudget: 0,
            approvedBudget: 0,
            audience: 0,
            appeals: 0,
            signedTerms: 0,
            accountabilities: 0
        });

        return res.json({
            notice: {
                id: notice.id,
                title: notice.title,
                description: notice.description,
                status: notice.status,
                totalBudget: notice.totalBudget,
                inscriptionStart: notice.inscriptionStart,
                inscriptionEnd: notice.inscriptionEnd,
                resultsDate: notice.resultsDate,
                executionEnd: notice.executionEnd,
                tenant: notice.tenant
            },
            totals,
            projects
        });
    } catch (err) {
        console.error("Erro ao buscar transparência do edital", err);
        return res.status(500).json({ message: "Erro ao buscar transparência do edital" });
    }
});

// ========== ADMIN ENDPOINTS ==========

// Lista todos os editais do tenant (admin)
router.get("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === Role.MASTER ? (req.query.tenantId as string) : user.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: "tenantId é obrigatório" });
        }

        // Verificar se tenant tem feature habilitada
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { featureEditais: true }
        });

        if (!tenant?.featureEditais && user.role !== Role.MASTER) {
            return res.status(403).json({ message: "Módulo de editais não habilitado para este tenant" });
        }

        const notices = await prisma.publicNotice.findMany({
            where: { tenantId },
            orderBy: { createdAt: "desc" },
            include: {
                culturalProjects: {
                    select: { status: true }
                },
                _count: { select: { culturalProjects: true } }
            }
        });

        // Agrupar status por edital
        const noticesWithStats = notices.map(notice => {
            const stats = notice.culturalProjects.reduce((acc: any, p: any) => {
                acc[p.status] = (acc[p.status] || 0) + 1;
                return acc;
            }, {});

            const { culturalProjects: projects, ...noticeData } = notice;
            return {
                ...noticeData,
                stats
            };
        });

        return res.json(noticesWithStats);
    } catch (err) {
        console.error("Erro ao listar editais", err);
        return res.status(500).json({ message: "Erro ao listar editais" });
    }
});

// Publicar RESULTADOS do edital
router.put("/:id/publish-results", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const existing = await prisma.publicNotice.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ message: "Edital não encontrado" });
        }

        if (user.role !== Role.MASTER && existing.tenantId !== user.tenantId) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        const notice = await prisma.publicNotice.update({
            where: { id },
            data: {
                status: "RESULTS_PUBLISHED",
                resultsDate: new Date()
            }
        });

        return res.json(notice);
    } catch (err) {
        console.error("Erro ao publicar resultados", err);
        return res.status(500).json({ message: "Erro ao publicar resultados" });
    }
});

// Detalhes do edital (admin)
router.get("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const notice = await prisma.publicNotice.findUnique({
            where: { id },
            include: {
                tenant: true,
                culturalProjects: {
                    orderBy: { createdAt: "desc" },
                    take: 50
                },
                _count: { select: { culturalProjects: true } }
            }
        });

        if (!notice) {
            return res.status(404).json({ message: "Edital não encontrado" });
        }

        // Verificar permissão
        if (user.role !== Role.MASTER && notice.tenantId !== user.tenantId) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        return res.json(notice);
    } catch (err) {
        console.error("Erro ao buscar edital", err);
        return res.status(500).json({ message: "Erro ao buscar edital" });
    }
});

// Criar edital
const createNoticeSchema = z.object({
    title: z.string().min(1, "Título é obrigatório"),
    description: z.string().optional(),
    objectives: z.string().optional(),
    requirements: z.string().optional(),
    inscriptionStart: z.string().datetime().nullable().optional(),
    inscriptionEnd: z.string().datetime().nullable().optional(),
    evaluationEnd: z.string().datetime().nullable().optional(),
    resultsDate: z.string().datetime().nullable().optional(),
    executionEnd: z.string().datetime().nullable().optional(),
    totalBudget: z.number().nullable().optional(),
    maxPerProject: z.number().nullable().optional(),
    minPerProject: z.number().nullable().optional(),
    culturalCategories: z.array(z.string()).default([]),
    targetRegions: z.array(z.string()).default([]),
    documentUrl: z.string().optional(),
    requiresAccessibilityPlan: z.boolean().default(true),
    showScoresInResults: z.boolean().default(true)
});

router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === Role.MASTER ? (req.body.tenantId as string) : user.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: "tenantId é obrigatório" });
        }

        // Verificar feature
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { featureEditais: true }
        });

        if (!tenant?.featureEditais && user.role !== Role.MASTER) {
            return res.status(403).json({ message: "Módulo de editais não habilitado" });
        }

        const data = createNoticeSchema.parse(req.body);

        const notice = await prisma.publicNotice.create({
            data: {
                title: data.title,
                description: data.description,
                objectives: data.objectives,
                requirements: data.requirements,
                inscriptionStart: data.inscriptionStart ? new Date(data.inscriptionStart) : new Date(),
                inscriptionEnd: data.inscriptionEnd ? new Date(data.inscriptionEnd) : new Date(),
                evaluationEnd: data.evaluationEnd ? new Date(data.evaluationEnd) : null,
                resultsDate: data.resultsDate ? new Date(data.resultsDate) : null,
                executionEnd: data.executionEnd ? new Date(data.executionEnd) : null,
                totalBudget: data.totalBudget,
                maxPerProject: data.maxPerProject,
                minPerProject: data.minPerProject,
                culturalCategories: data.culturalCategories,
                targetRegions: data.targetRegions,
                documentUrl: data.documentUrl,
                requiresAccessibilityPlan: data.requiresAccessibilityPlan,
                showScoresInResults: data.showScoresInResults,
                status: "DRAFT",
                tenantId
            }
        });

        return res.status(201).json(notice);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
        }
        console.error("Erro ao criar edital", err);
        return res.status(500).json({ message: "Erro ao criar edital" });
    }
});

// Atualizar edital
router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const existing = await prisma.publicNotice.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ message: "Edital não encontrado" });
        }

        if (user.role !== Role.MASTER && existing.tenantId !== user.tenantId) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        const {
            title, description, objectives, requirements,
            inscriptionStart, inscriptionEnd, evaluationEnd, resultsDate, executionEnd,
            totalBudget, maxPerProject, minPerProject,
            culturalCategories, targetRegions, documentUrl, requiresAccessibilityPlan,
            showScoresInResults, status
        } = req.body;

        const notice = await prisma.publicNotice.update({
            where: { id },
            data: {
                ...(title && { title }),
                ...(description !== undefined && { description }),
                ...(objectives !== undefined && { objectives }),
                ...(requirements !== undefined && { requirements }),
                ...(inscriptionStart && { inscriptionStart: new Date(inscriptionStart) }),
                ...(inscriptionEnd && { inscriptionEnd: new Date(inscriptionEnd) }),
                ...(evaluationEnd !== undefined && { evaluationEnd: evaluationEnd ? new Date(evaluationEnd) : null }),
                ...(resultsDate !== undefined && { resultsDate: resultsDate ? new Date(resultsDate) : null }),
                ...(executionEnd !== undefined && { executionEnd: executionEnd ? new Date(executionEnd) : null }),
                ...(totalBudget !== undefined && { totalBudget }),
                ...(maxPerProject !== undefined && { maxPerProject }),
                ...(minPerProject !== undefined && { minPerProject }),
                ...(culturalCategories && { culturalCategories }),
                ...(targetRegions && { targetRegions }),
                ...(documentUrl !== undefined && { documentUrl }),
                ...(requiresAccessibilityPlan !== undefined && { requiresAccessibilityPlan }),
                ...(showScoresInResults !== undefined && { showScoresInResults }),
                ...(status && { status })
            }
        });

        return res.json(notice);
    } catch (err) {
        console.error("Erro ao atualizar edital", err);
        return res.status(500).json({ message: "Erro ao atualizar edital" });
    }
});

// Publicar edital
router.put("/:id/publish", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const existing = await prisma.publicNotice.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ message: "Edital não encontrado" });
        }

        if (user.role !== Role.MASTER && existing.tenantId !== user.tenantId) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        const now = new Date();
        let newStatus: NoticeStatus = "PUBLISHED";

        // Determinar status baseado nas datas
        if (now >= existing.inscriptionStart && now <= existing.inscriptionEnd) {
            newStatus = "INSCRIPTIONS_OPEN";
        } else if (now > existing.inscriptionEnd) {
            newStatus = "INSCRIPTIONS_CLOSED";
        }

        const notice = await prisma.publicNotice.update({
            where: { id },
            data: {
                status: newStatus,
                publishDate: now
            }
        });

        return res.json(notice);
    } catch (err) {
        console.error("Erro ao publicar edital", err);
        return res.status(500).json({ message: "Erro ao publicar edital" });
    }
});

// Deletar edital
router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const existing = await prisma.publicNotice.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ message: "Edital não encontrado" });
        }

        if (user.role !== Role.MASTER && existing.tenantId !== user.tenantId) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        await prisma.publicNotice.delete({ where: { id } });
        return res.status(204).send();
    } catch (err) {
        console.error("Erro ao deletar edital", err);
        return res.status(500).json({ message: "Erro ao deletar edital" });
    }
});

// Projetos inscritos no edital
router.get("/:id/projects", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const notice = await prisma.publicNotice.findUnique({ where: { id } });
        if (!notice) {
            return res.status(404).json({ message: "Edital não encontrado" });
        }

        if (user.role !== Role.MASTER && notice.tenantId !== user.tenantId) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        const projects = await prisma.culturalProject.findMany({
            where: { noticeId: id },
            orderBy: { createdAt: "desc" }
        });

        return res.json(projects);
    } catch (err) {
        console.error("Erro ao listar projetos do edital", err);
        return res.status(500).json({ message: "Erro ao listar projetos" });
    }
});

export default router;
