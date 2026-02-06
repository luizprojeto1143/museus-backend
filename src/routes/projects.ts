import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { z } from "zod";

const router = Router();

// ========== ADMIN/SECRETARIA ENDPOINTS ==========

// Lista todos os projetos do tenant
router.get("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === Role.MASTER ? (req.query.tenantId as string) : user.tenantId;
        const { status, noticeId, culturalCategory, targetRegion } = req.query;

        if (!tenantId) {
            return res.status(400).json({ message: "tenantId é obrigatório" });
        }

        const where: any = { tenantId };
        if (status) where.status = status;
        if (noticeId) where.noticeId = noticeId;
        if (culturalCategory) where.culturalCategory = culturalCategory;
        if (targetRegion) where.targetRegion = targetRegion;

        const projects = await prisma.culturalProject.findMany({
            where,
            orderBy: { createdAt: "desc" },
            include: {
                notice: { select: { id: true, title: true, status: true } },
                _count: { select: { accessibilityExecutions: true } }
            }
        });

        return res.json(projects);
    } catch (err) {
        console.error("Erro ao listar projetos", err);
        return res.status(500).json({ message: "Erro ao listar projetos" });
    }
});

// Meus projetos (proponente)
router.get("/my", authMiddleware, async (req, res) => {
    try {
        const user = req.user!;

        const projects = await prisma.culturalProject.findMany({
            where: { proponentId: user.id },
            orderBy: { createdAt: "desc" },
            include: {
                notice: { select: { id: true, title: true, status: true } },
                tenant: { select: { id: true, name: true, slug: true } }
            }
        });

        return res.json(projects);
    } catch (err) {
        console.error("Erro ao listar meus projetos", err);
        return res.status(500).json({ message: "Erro ao listar projetos" });
    }
});

// Detalhes do projeto
router.get("/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const project = await prisma.culturalProject.findUnique({
            where: { id },
            include: {
                notice: true,
                tenant: { select: { id: true, name: true, slug: true } },
                accessibilityExecutions: {
                    include: {
                        provider: { select: { id: true, name: true } }
                    }
                }
            }
        });

        if (!project) {
            return res.status(404).json({ message: "Projeto não encontrado" });
        }

        // Verificar permissão: proponente, admin do tenant ou master
        const isOwner = project.proponentId === user.id;
        const isAdmin = user.role === Role.ADMIN && project.tenantId === user.tenantId;
        const isMaster = user.role === Role.MASTER;

        if (!isOwner && !isAdmin && !isMaster) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        return res.json(project);
    } catch (err) {
        console.error("Erro ao buscar projeto", err);
        return res.status(500).json({ message: "Erro ao buscar projeto" });
    }
});

// Criar projeto (proponente ou admin)
const createProjectSchema = z.object({
    title: z.string().min(1, "Título é obrigatório"),
    summary: z.string().optional(),
    description: z.string().optional(),
    justification: z.string().optional(),
    culturalCategory: z.string().optional(),
    targetRegion: z.string().optional(),
    targetAudience: z.string().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    requestedBudget: z.number().optional(),
    expectedAudience: z.number().optional(),
    proposalUrl: z.string().optional(),
    accessibilityPlan: z.any().optional(),
    noticeId: z.string().optional(),
    tenantId: z.string()
});

router.post("/", authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const data = createProjectSchema.parse(req.body);

        // Verificar se tenant tem feature habilitada
        const tenant = await prisma.tenant.findUnique({
            where: { id: data.tenantId },
            select: { featureProjects: true }
        });

        if (!tenant?.featureProjects && user.role !== Role.MASTER) {
            return res.status(403).json({ message: "Módulo de projetos não habilitado" });
        }

        // Se vincular a edital, verificar se está aberto
        if (data.noticeId) {
            const notice = await prisma.publicNotice.findUnique({ where: { id: data.noticeId } });
            if (!notice) {
                return res.status(404).json({ message: "Edital não encontrado" });
            }
            if (notice.status !== "INSCRIPTIONS_OPEN") {
                return res.status(400).json({ message: "Edital não está com inscrições abertas" });
            }
        }

        const project = await prisma.culturalProject.create({
            data: {
                title: data.title,
                summary: data.summary,
                description: data.description,
                justification: data.justification,
                culturalCategory: data.culturalCategory,
                targetRegion: data.targetRegion,
                targetAudience: data.targetAudience,
                startDate: data.startDate ? new Date(data.startDate) : null,
                endDate: data.endDate ? new Date(data.endDate) : null,
                requestedBudget: data.requestedBudget,
                expectedAudience: data.expectedAudience,
                proposalUrl: data.proposalUrl,
                accessibilityPlan: data.accessibilityPlan,
                noticeId: data.noticeId,
                proponentId: user.id,
                tenantId: data.tenantId,
                status: "DRAFT"
            }
        });

        return res.status(201).json(project);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
        }
        console.error("Erro ao criar projeto", err);
        return res.status(500).json({ message: "Erro ao criar projeto" });
    }
});

// Atualizar projeto
router.put("/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const existing = await prisma.culturalProject.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ message: "Projeto não encontrado" });
        }

        // Verificar permissão
        const isOwner = existing.proponentId === user.id;
        const isAdmin = user.role === Role.ADMIN && existing.tenantId === user.tenantId;
        const isMaster = user.role === Role.MASTER;

        if (!isOwner && !isAdmin && !isMaster) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        // Proponente só pode editar se estiver em DRAFT
        if (isOwner && !isAdmin && !isMaster && existing.status !== "DRAFT") {
            return res.status(400).json({ message: "Projeto já submetido, não pode ser editado" });
        }

        const {
            title, summary, description, justification,
            culturalCategory, targetRegion, targetAudience,
            startDate, endDate, requestedBudget, expectedAudience,
            proposalUrl, accessibilityPlan
        } = req.body;

        const project = await prisma.culturalProject.update({
            where: { id },
            data: {
                ...(title && { title }),
                ...(summary !== undefined && { summary }),
                ...(description !== undefined && { description }),
                ...(justification !== undefined && { justification }),
                ...(culturalCategory !== undefined && { culturalCategory }),
                ...(targetRegion !== undefined && { targetRegion }),
                ...(targetAudience !== undefined && { targetAudience }),
                ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
                ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
                ...(requestedBudget !== undefined && { requestedBudget }),
                ...(expectedAudience !== undefined && { expectedAudience }),
                ...(proposalUrl !== undefined && { proposalUrl }),
                ...(accessibilityPlan !== undefined && { accessibilityPlan })
            }
        });

        return res.json(project);
    } catch (err) {
        console.error("Erro ao atualizar projeto", err);
        return res.status(500).json({ message: "Erro ao atualizar projeto" });
    }
});

// Submeter projeto ao edital
router.post("/:id/submit", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const project = await prisma.culturalProject.findUnique({
            where: { id },
            include: { notice: true }
        });

        if (!project) {
            return res.status(404).json({ message: "Projeto não encontrado" });
        }

        if (project.proponentId !== user.id && user.role !== Role.MASTER) {
            return res.status(403).json({ message: "Apenas o proponente pode submeter" });
        }

        if (project.status !== "DRAFT") {
            return res.status(400).json({ message: "Projeto já foi submetido" });
        }

        if (!project.noticeId || !project.notice) {
            return res.status(400).json({ message: "Projeto precisa estar vinculado a um edital" });
        }

        if (project.notice.status !== "INSCRIPTIONS_OPEN") {
            return res.status(400).json({ message: "Inscrições do edital encerradas" });
        }

        // Verificar se plano de acessibilidade é obrigatório
        if (project.notice.requiresAccessibilityPlan && !project.accessibilityPlan) {
            return res.status(400).json({ message: "Plano de acessibilidade é obrigatório para este edital" });
        }

        const updated = await prisma.culturalProject.update({
            where: { id },
            data: { status: "SUBMITTED" }
        });

        return res.json(updated);
    } catch (err) {
        console.error("Erro ao submeter projeto", err);
        return res.status(500).json({ message: "Erro ao submeter projeto" });
    }
});

// Alterar status do projeto (admin/secretaria)
router.put("/:id/status", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const { status, approvedBudget, notes } = req.body;
        const user = req.user!;

        const project = await prisma.culturalProject.findUnique({ where: { id } });
        if (!project) {
            return res.status(404).json({ message: "Projeto não encontrado" });
        }

        if (user.role !== Role.MASTER && project.tenantId !== user.tenantId) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        const validStatuses = ["UNDER_REVIEW", "APPROVED", "REJECTED", "IN_EXECUTION", "COMPLETED", "CANCELED"];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ message: "Status inválido" });
        }

        const updated = await prisma.culturalProject.update({
            where: { id },
            data: {
                status,
                ...(approvedBudget !== undefined && { approvedBudget })
            }
        });

        return res.json(updated);
    } catch (err) {
        console.error("Erro ao atualizar status", err);
        return res.status(500).json({ message: "Erro ao atualizar status" });
    }
});

// Deletar projeto
router.delete("/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const project = await prisma.culturalProject.findUnique({ where: { id } });
        if (!project) {
            return res.status(404).json({ message: "Projeto não encontrado" });
        }

        const isOwner = project.proponentId === user.id;
        const isAdmin = user.role === Role.ADMIN && project.tenantId === user.tenantId;
        const isMaster = user.role === Role.MASTER;

        if (!isOwner && !isAdmin && !isMaster) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        // Proponente só pode deletar se estiver em DRAFT
        if (isOwner && !isAdmin && !isMaster && project.status !== "DRAFT") {
            return res.status(400).json({ message: "Projeto já submetido, não pode ser excluído" });
        }

        await prisma.culturalProject.delete({ where: { id } });
        return res.status(204).send();
    } catch (err) {
        console.error("Erro ao deletar projeto", err);
        return res.status(500).json({ message: "Erro ao deletar projeto" });
    }
});

// Relatório de acessibilidade do projeto
router.get("/:id/accessibility", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const project = await prisma.culturalProject.findUnique({
            where: { id },
            include: {
                accessibilityExecutions: {
                    include: {
                        provider: { select: { id: true, name: true, email: true } }
                    },
                    orderBy: { createdAt: "desc" }
                }
            }
        });

        if (!project) {
            return res.status(404).json({ message: "Projeto não encontrado" });
        }

        const isOwner = project.proponentId === user.id;
        const isAdmin = user.role === Role.ADMIN && project.tenantId === user.tenantId;
        const isMaster = user.role === Role.MASTER;

        if (!isOwner && !isAdmin && !isMaster) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        return res.json({
            accessibilityPlan: project.accessibilityPlan,
            executions: project.accessibilityExecutions
        });
    } catch (err) {
        console.error("Erro ao buscar acessibilidade", err);
        return res.status(500).json({ message: "Erro ao buscar informações" });
    }
});

// Publicar projeto como evento (Agenda)
router.post("/:id/publish-event", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const project = await prisma.culturalProject.findUnique({
            where: { id },
            include: { notice: true }
        });

        if (!project) return res.status(404).json({ message: "Projeto não encontrado" });
        if (project.eventId) return res.status(400).json({ message: "Projeto já publicado como evento" });

        // Find or create default category
        let category = await prisma.category.findFirst({
            where: { tenantId: project.tenantId, type: "EVENT" }
        });

        if (!category) {
            category = await prisma.category.create({
                data: {
                    name: "Projetos Culturais",
                    type: "EVENT",
                    tenantId: project.tenantId
                }
            });
        }

        const event = await prisma.event.create({
            data: {
                title: project.title,
                description: project.description || project.summary || "",
                tenantId: project.tenantId,
                categoryId: category.id,
                startDate: project.startDate || new Date(),
                endDate: project.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                location: project.targetRegion || "Local a definir",
                status: "PUBLISHED",
                coverUrl: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=1470&auto=format&fit=crop", // Stock event image
                format: "PRESENTIAL", // Default
                visibility: "PUBLIC"
            }
        });

        // Link back and update status
        await prisma.culturalProject.update({
            where: { id },
            data: {
                eventId: event.id,
                status: "IN_EXECUTION"
            }
        });

        return res.json({ message: "Evento criado com sucesso!", eventId: event.id });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Erro ao publicar evento" });
    }
});

export default router;
