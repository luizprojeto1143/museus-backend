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
                _count: { select: { projects: true } }
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
                _count: { select: { projects: true } }
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

// ========== ADMIN ENDPOINTS ==========

// Lista todos os editais do tenant (admin)
router.get("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
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
                _count: { select: { projects: true } }
            }
        });

        return res.json(notices);
    } catch (err) {
        console.error("Erro ao listar editais", err);
        return res.status(500).json({ message: "Erro ao listar editais" });
    }
});

// Detalhes do edital (admin)
router.get("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const notice = await prisma.publicNotice.findUnique({
            where: { id },
            include: {
                tenant: true,
                projects: {
                    orderBy: { createdAt: "desc" },
                    take: 50
                },
                _count: { select: { projects: true } }
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
    inscriptionStart: z.string().datetime(),
    inscriptionEnd: z.string().datetime(),
    evaluationEnd: z.string().datetime().optional(),
    resultsDate: z.string().datetime().optional(),
    executionEnd: z.string().datetime().optional(),
    totalBudget: z.number().optional(),
    maxPerProject: z.number().optional(),
    minPerProject: z.number().optional(),
    culturalCategories: z.array(z.string()).default([]),
    targetRegions: z.array(z.string()).default([]),
    documentUrl: z.string().optional(),
    requiresAccessibilityPlan: z.boolean().default(true)
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
                inscriptionStart: new Date(data.inscriptionStart),
                inscriptionEnd: new Date(data.inscriptionEnd),
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
router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
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
            culturalCategories, targetRegions, documentUrl, requiresAccessibilityPlan, status
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
router.put("/:id/publish", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
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
router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
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
router.get("/:id/projects", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
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
