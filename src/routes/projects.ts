import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { z } from "zod";
import { analyzeProjectWithAI } from "../services/projectAnalysis.js";
import { createAuditLog } from "../services/audit.service.js";
import { mailService } from "../services/email.js";
import PDFDocument from "pdfkit";

const router = Router();

async function resolveProjectTenant(
    user: { role: Role; tenantId?: string | null } | undefined,
    bodyTenantId: string,
    noticeId?: string
) {
    if (!user) return null;
    if (user.role === Role.MASTER) return bodyTenantId;
    if (user.tenantId) return user.tenantId;

    if (noticeId) {
        const notice = await prisma.publicNotice.findUnique({
            where: { id: noticeId },
            select: { tenantId: true }
        });
        return notice?.tenantId || null;
    }

    return null;
}

async function getProjectOr404(id: string) {
    return prisma.culturalProject.findUnique({
        where: { id },
        include: {
            publicNotice: { select: { id: true, title: true, status: true } },
            tenant: { select: { id: true, name: true } },
            user: { select: { id: true, name: true, email: true } }
        }
    });
}

function canAccessProjectWorkflow(
    project: { proponentId: string; tenantId: string },
    user: { id: string; role: Role; tenantId?: string | null }
) {
    return project.proponentId === user.id
        || user.role === Role.MASTER
        || ((user.role === Role.ADMIN || user.role === Role.COLLABORATOR) && project.tenantId === user.tenantId);
}

function canAdminProjectWorkflow(
    project: { tenantId: string },
    user: { role: Role; tenantId?: string | null }
) {
    return user.role === Role.MASTER
        || ((user.role === Role.ADMIN || user.role === Role.COLLABORATOR) && project.tenantId === user.tenantId);
}

function getActorIp(req: any) {
    return String(req.ip || req.headers["x-forwarded-for"] || "");
}

function getActorAgent(req: any) {
    return typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined;
}

function publicApiBase(req: any) {
    return process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`;
}

async function notifyProjectProponent(project: { user?: { email?: string | null; name?: string | null } | null; title: string }, subject: string, body: string) {
    const email = project.user?.email;
    if (!email) return;
    await mailService.sendGenericEmail(email, subject, `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #1f2937;">
            <h2 style="color:#111827;">${subject}</h2>
            <p>Olá${project.user?.name ? `, ${project.user.name}` : ""}.</p>
            <p>${body}</p>
            <p><strong>Projeto:</strong> ${project.title}</p>
            <p style="color:#6b7280; font-size:12px;">Mensagem automática do Cultura Viva.</p>
        </div>
    `);
}

function streamProjectTermPdf(res: any, term: any, project: any) {
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="termo-${term.id}.pdf"`);
    doc.pipe(res);

    doc.font("Helvetica-Bold").fontSize(18).text(term.title || "Termo de Execução Cultural", { align: "center" });
    doc.moveDown();
    doc.font("Helvetica").fontSize(11).text(`Projeto: ${project.title}`);
    doc.text(`Proponente: ${project.user?.name || "Não informado"}`);
    doc.text(`Município/tenant: ${project.tenant?.name || project.tenantId}`);
    doc.text(`Status do termo: ${term.status}`);
    if (term.signedAt) doc.text(`Assinado em: ${new Date(term.signedAt).toLocaleString("pt-BR")}`);
    doc.moveDown();
    doc.font("Helvetica-Bold").text("Cláusulas e condições");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(11).text(term.termsText || "", { align: "justify" });
    doc.moveDown();
    doc.fontSize(9).fillColor("#555").text(`Documento gerado automaticamente pelo Cultura Viva. ID do termo: ${term.id}`);
    doc.end();
}

function streamProjectAccountabilityPdf(res: any, accountability: any, project: any) {
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="prestacao-contas-${accountability.id}.pdf"`);
    doc.pipe(res);

    doc.font("Helvetica-Bold").fontSize(18).text("Prestação de Contas do Projeto", { align: "center" });
    doc.moveDown();
    doc.font("Helvetica").fontSize(11).text(`Projeto: ${project.title}`);
    doc.text(`Proponente: ${project.user?.name || "Não informado"}`);
    doc.text(`Município/tenant: ${project.tenant?.name || project.tenantId}`);
    doc.text(`Status: ${accountability.status}`);
    if (accountability.submittedAt) doc.text(`Enviada em: ${new Date(accountability.submittedAt).toLocaleString("pt-BR")}`);
    if (accountability.reviewedAt) doc.text(`Revisada em: ${new Date(accountability.reviewedAt).toLocaleString("pt-BR")}`);
    doc.moveDown();
    doc.font("Helvetica-Bold").text("Resumo da execução");
    doc.font("Helvetica").text(accountability.executionSummary || "Não informado.", { align: "justify" });
    doc.moveDown();
    doc.text(`Público alcançado: ${accountability.audienceReached ?? "Não informado"}`);
    doc.text(`Valor executado: R$ ${Number(accountability.amountSpent || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
    if (accountability.reviewNotes) {
        doc.moveDown();
        doc.font("Helvetica-Bold").text("Parecer da gestão");
        doc.font("Helvetica").text(accountability.reviewNotes, { align: "justify" });
    }
    doc.moveDown();
    doc.fontSize(9).fillColor("#555").text(`Documento gerado automaticamente pelo Cultura Viva. ID da prestação: ${accountability.id}`);
    doc.end();
}

// ========== ADMIN/SECRETARIA ENDPOINTS ==========

// Lista todos os projetos do tenant
router.get("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === Role.MASTER ? (req.query.tenantId as string) : user.tenantId;
        const { status, noticeId, culturalCategory, targetRegion, consolidated } = req.query;
 
         if (!tenantId) {
             return res.status(400).json({ message: "tenantId é obrigatório" });
         }
 
         let targetTenantIds = [tenantId];
 
         if (consolidated === "true") {
             const children = await prisma.tenant.findMany({
                 where: { parentId: tenantId },
                 select: { id: true }
             });
             targetTenantIds = [tenantId, ...children.map(c => c.id)];
         }
 
         const where: any = { tenantId: { in: targetTenantIds } };
         if (status) where.status = status;
         if (noticeId) where.noticeId = noticeId;
         if (culturalCategory) where.culturalCategory = culturalCategory;
         if (targetRegion) where.targetRegion = targetRegion;
 
         const projects = await prisma.culturalProject.findMany({
             where,
             orderBy: { createdAt: "desc" },
             include: {
                 publicNotice: { select: { id: true, title: true, status: true } },
                 user: { select: { id: true, name: true, email: true } },
                 tenant: { select: { name: true } },
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
                publicNotice: { select: { id: true, title: true, status: true } },
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
                publicNotice: true,
                tenant: { select: { id: true, name: true, slug: true } },
                user: { select: { id: true, name: true, email: true } },
                accessibilityExecutions: {
                    include: {
                        accessibilityProvider: { select: { id: true, name: true } }
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
    tenantId: z.string().optional()
});

router.post("/", authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const data = createProjectSchema.parse(req.body);
        const targetTenantId = await resolveProjectTenant(user, data.tenantId || "", data.noticeId);
        if (!targetTenantId) {
            return res.status(400).json({ message: "tenantId e obrigatorio" });
        }

        // Verificar se tenant tem feature habilitada
        const tenant = await prisma.tenant.findUnique({
            where: { id: targetTenantId },
            select: { featureProjects: true, featureEditaisSubmission: true }
        });

        if (!tenant) {
            return res.status(404).json({ message: "Tenant nao encontrado" });
        }

        if (!tenant?.featureProjects && user.role !== Role.MASTER) {
            return res.status(403).json({ message: "Módulo de projetos não habilitado" });
        }

        // Se vincular a edital, verificar regras
        if (data.noticeId) {
            // 1. Verificar permissão de submissão
            if (!tenant?.featureEditaisSubmission && user.role !== Role.MASTER) {
                return res.status(403).json({ message: "Submissão de editais não habilitada para este produtor/cidade." });
            }

            // 2. Verificar se está aberto
            const notice = await prisma.publicNotice.findUnique({ where: { id: data.noticeId } });
            if (!notice) {
                return res.status(404).json({ message: "Edital não encontrado" });
            }
            if (notice.tenantId !== targetTenantId) {
                return res.status(403).json({ message: "Edital nao pertence ao tenant do projeto" });
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
                tenantId: targetTenantId,
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
                ...(accessibilityPlan !== undefined && { accessibilityPlan }),
                ...(req.body.attachments !== undefined && { attachments: req.body.attachments })
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
            include: { publicNotice: true, tenant: true }
        });

        if (!project) {
            return res.status(404).json({ message: "Projeto não encontrado" });
        }

        // Check feature flag
        if (!project.tenant?.featureEditaisSubmission && user.role !== Role.MASTER) {
            return res.status(403).json({ message: "Submissão de editais não habilitada." });
        }

        if (project.proponentId !== user.id && user.role !== Role.MASTER) {
            return res.status(403).json({ message: "Apenas o proponente pode submeter" });
        }

        if (project.status !== "DRAFT") {
            return res.status(400).json({ message: "Projeto já foi submetido" });
        }

        if (!project.noticeId || !project.publicNotice) {
            return res.status(400).json({ message: "Projeto precisa estar vinculado a um edital" });
        }

        if (project.publicNotice?.status !== "INSCRIPTIONS_OPEN") {
            return res.status(400).json({ message: "Inscrições do edital encerradas" });
        }

        // Verificar se plano de acessibilidade é obrigatório
        if (project.publicNotice?.requiresAccessibilityPlan && !project.accessibilityPlan) {
            return res.status(400).json({ message: "Plano de acessibilidade é obrigatório para este edital" });
        }

        const updated = await prisma.culturalProject.update({
            where: { id },
            data: { status: "SUBMITTED" }
        });

        // Trigger AI analysis asynchronously (fire-and-forget)
        analyzeProjectWithAI(id, project.tenantId).catch(err => {
            console.error("Erro na análise IA automática:", err);
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
        const { status, approvedBudget, notes, humanScore } = req.body;
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

        // Calcular Score Final se houver análise IA
        let finalScore = null;
        const hScore = humanScore !== undefined ? parseFloat(humanScore) : project.humanScore;

        if (project.aiAnalysis) {
            const aiData = project.aiAnalysis as any;
            const scores = aiData.scores || {};
            const scoreValues = Object.values(scores) as number[];
            if (scoreValues.length > 0) {
                const aiAvg = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length;
                if (hScore !== null && hScore !== undefined) {
                    finalScore = (aiAvg + hScore) / 2;
                } else {
                    finalScore = aiAvg;
                }
            }
        } else if (hScore !== null && hScore !== undefined) {
            finalScore = hScore;
        }

        const updated = await prisma.culturalProject.update({
            where: { id },
            data: {
                status,
                ...(approvedBudget !== undefined && { approvedBudget }),
                ...(notes !== undefined && { reviewNotes: notes }),
                ...(humanScore !== undefined && { humanScore: hScore }),
                finalScore,
                reviewedAt: new Date(),
                reviewedBy: user.id
            }
        });

        // AUTO-UNLOCK FEATURES FOR PRODUCER UPON APPROVAL
        if (status === "APPROVED") {
            try {
                const proponent = await prisma.user.findUnique({
                    where: { id: project.proponentId },
                    select: { tenantId: true, role: true }
                });

                if (proponent?.tenantId && proponent.role === Role.PRODUCER) {
                    await prisma.tenant.update({
                        where: { id: proponent.tenantId },
                        data: {
                            featureTickets: true,
                            featureEvents: true,
                            featureGamification: true,
                            featureWorks: true,
                            featureAccessibility: true,
                            featureCertificates: true,
                            featureReviews: true
                        }
                    });
                    console.log(`[PROJECTS] Features unlocked for tenant ${proponent.tenantId} (Producer Approved)`);
                }
            } catch (unlockErr) {
                console.error("[PROJECTS] Failed to auto-unlock producer features:", unlockErr);
            }
        }

        return res.json(updated);
    } catch (err) {
        console.error("Erro ao atualizar status", err);
        return res.status(500).json({ message: "Erro ao atualizar status" });
    }
});

// Ciclo institucional do edital: recursos, termos e prestação de contas
router.get("/:id/workflow", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;
        const project = await getProjectOr404(id);
        if (!project) return res.status(404).json({ message: "Projeto não encontrado" });
        if (!canAccessProjectWorkflow(project, user)) return res.status(403).json({ message: "Sem permissão" });

        const [appeals, terms, accountabilities] = await Promise.all([
            prisma.projectAppeal.findMany({
                where: { projectId: id },
                orderBy: { createdAt: "desc" }
            }),
            prisma.projectTerm.findMany({
                where: { projectId: id },
                orderBy: { createdAt: "desc" }
            }),
            prisma.projectAccountability.findMany({
                where: { projectId: id },
                orderBy: { createdAt: "desc" }
            })
        ]);

        return res.json({ project, appeals, terms, accountabilities });
    } catch (err) {
        console.error("Erro ao buscar workflow do projeto", err);
        return res.status(500).json({ message: "Erro ao buscar ciclo do projeto" });
    }
});

const createAppealSchema = z.object({
    reason: z.string().min(10),
    requestedAdjustment: z.string().optional()
});

router.post("/:id/appeals", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;
        const data = createAppealSchema.parse(req.body);
        const project = await getProjectOr404(id);
        if (!project) return res.status(404).json({ message: "Projeto não encontrado" });
        if (project.proponentId !== user.id && user.role !== Role.MASTER) {
            return res.status(403).json({ message: "Apenas o proponente pode abrir recurso" });
        }
        if (!["UNDER_REVIEW", "APPROVED", "REJECTED"].includes(project.status)) {
            return res.status(400).json({ message: "Recurso só pode ser aberto após avaliação preliminar" });
        }

        const appeal = await prisma.projectAppeal.create({
            data: {
                projectId: project.id,
                noticeId: project.noticeId,
                tenantId: project.tenantId,
                proponentId: project.proponentId,
                reason: data.reason,
                requestedAdjustment: data.requestedAdjustment
            }
        });

        await createAuditLog({
            tenantId: project.tenantId,
            userId: user.id,
            action: "CUSTOM",
            entityType: "ProjectAppeal",
            entityId: appeal.id,
            ipAddress: getActorIp(req),
            userAgent: getActorAgent(req),
            metadata: { event: "PROJECT_APPEAL_SUBMITTED", projectId: project.id, noticeId: project.noticeId }
        });

        return res.status(201).json(appeal);
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
        console.error("Erro ao criar recurso", err);
        return res.status(500).json({ message: "Erro ao criar recurso" });
    }
});

const reviewAppealSchema = z.object({
    status: z.enum(["UNDER_REVIEW", "ACCEPTED", "REJECTED", "PARTIALLY_ACCEPTED"]),
    response: z.string().min(3)
});

router.put("/:id/appeals/:appealId", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), async (req, res) => {
    try {
        const { id, appealId } = req.params;
        const user = req.user!;
        const data = reviewAppealSchema.parse(req.body);
        const project = await getProjectOr404(id);
        if (!project) return res.status(404).json({ message: "Projeto não encontrado" });
        if (!canAdminProjectWorkflow(project, user)) return res.status(403).json({ message: "Sem permissão" });

        const appeal = await prisma.projectAppeal.findFirst({ where: { id: appealId, projectId: id } });
        if (!appeal) return res.status(404).json({ message: "Recurso não encontrado" });

        const updated = await prisma.projectAppeal.update({
            where: { id: appealId },
            data: {
                status: data.status,
                response: data.response,
                reviewedBy: user.id,
                reviewedAt: new Date()
            }
        });

        await createAuditLog({
            tenantId: project.tenantId,
            userId: user.id,
            action: "CUSTOM",
            entityType: "ProjectAppeal",
            entityId: updated.id,
            ipAddress: getActorIp(req),
            userAgent: getActorAgent(req),
            metadata: { event: "PROJECT_APPEAL_REVIEWED", projectId: project.id, status: data.status }
        });
        await notifyProjectProponent(project, "Recurso analisado", `Seu recurso foi analisado com o status: <strong>${data.status}</strong>.`);

        return res.json(updated);
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
        console.error("Erro ao avaliar recurso", err);
        return res.status(500).json({ message: "Erro ao avaliar recurso" });
    }
});

const counterAppealSchema = z.object({
    counterResponse: z.string().min(10)
});

router.post("/:id/appeals/:appealId/counter", authMiddleware, async (req, res) => {
    try {
        const { id, appealId } = req.params;
        const user = req.user!;
        const data = counterAppealSchema.parse(req.body);
        const project = await getProjectOr404(id);
        if (!project) return res.status(404).json({ message: "Projeto não encontrado" });
        if (project.proponentId !== user.id && user.role !== Role.MASTER) {
            return res.status(403).json({ message: "Apenas o proponente pode enviar contrarrazão" });
        }

        const appeal = await prisma.projectAppeal.findFirst({ where: { id: appealId, projectId: id } });
        if (!appeal) return res.status(404).json({ message: "Recurso não encontrado" });

        const updated = await prisma.projectAppeal.update({
            where: { id: appealId },
            data: {
                type: "COUNTER_ARGUMENT",
                counterResponse: data.counterResponse
            }
        });

        await createAuditLog({
            tenantId: project.tenantId,
            userId: user.id,
            action: "CUSTOM",
            entityType: "ProjectAppeal",
            entityId: updated.id,
            ipAddress: getActorIp(req),
            userAgent: getActorAgent(req),
            metadata: { event: "PROJECT_APPEAL_COUNTER_ARGUMENT_SUBMITTED", projectId: project.id }
        });

        return res.json(updated);
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
        console.error("Erro ao enviar contrarrazão", err);
        return res.status(500).json({ message: "Erro ao enviar contrarrazão" });
    }
});

const createTermSchema = z.object({
    title: z.string().min(3),
    termsText: z.string().min(20),
    documentUrl: z.string().optional()
});

router.post("/:id/terms", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;
        const data = createTermSchema.parse(req.body);
        const project = await getProjectOr404(id);
        if (!project) return res.status(404).json({ message: "Projeto não encontrado" });
        if (!canAdminProjectWorkflow(project, user)) return res.status(403).json({ message: "Sem permissão" });
        if (!["APPROVED", "IN_EXECUTION", "COMPLETED"].includes(project.status)) {
            return res.status(400).json({ message: "Termo só pode ser emitido para projeto aprovado ou em execução" });
        }

        const term = await prisma.projectTerm.create({
            data: {
                projectId: project.id,
                tenantId: project.tenantId,
                proponentId: project.proponentId,
                title: data.title,
                termsText: data.termsText,
                documentUrl: data.documentUrl,
                createdBy: user.id
            }
        });

        const documentUrl = data.documentUrl || `${publicApiBase(req)}/projects/${project.id}/terms/${term.id}/pdf`;
        const updatedTerm = data.documentUrl ? term : await prisma.projectTerm.update({
            where: { id: term.id },
            data: { documentUrl }
        });

        await createAuditLog({
            tenantId: project.tenantId,
            userId: user.id,
            action: "CUSTOM",
            entityType: "ProjectTerm",
            entityId: term.id,
            ipAddress: getActorIp(req),
            userAgent: getActorAgent(req),
            metadata: { event: "PROJECT_TERM_ISSUED", projectId: project.id, documentUrl }
        });
        await notifyProjectProponent(project, "Termo disponível para assinatura", "A gestão emitiu um termo para assinatura no ciclo do edital.");

        return res.status(201).json(updatedTerm);
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
        console.error("Erro ao criar termo", err);
        return res.status(500).json({ message: "Erro ao criar termo" });
    }
});

const signTermSchema = z.object({
    signedDocumentUrl: z.string().optional()
});

router.post("/:id/terms/:termId/sign", authMiddleware, async (req, res) => {
    try {
        const { id, termId } = req.params;
        const user = req.user!;
        const data = signTermSchema.parse(req.body);
        const project = await getProjectOr404(id);
        if (!project) return res.status(404).json({ message: "Projeto não encontrado" });
        if (project.proponentId !== user.id && user.role !== Role.MASTER) {
            return res.status(403).json({ message: "Apenas o proponente pode assinar o termo" });
        }

        const term = await prisma.projectTerm.findFirst({ where: { id: termId, projectId: id } });
        if (!term) return res.status(404).json({ message: "Termo não encontrado" });
        if (term.status !== "PENDING_SIGNATURE") {
            return res.status(400).json({ message: "Termo não está pendente de assinatura" });
        }

        const updated = await prisma.projectTerm.update({
            where: { id: termId },
            data: {
                status: "SIGNED",
                signedDocumentUrl: data.signedDocumentUrl || `${publicApiBase(req)}/projects/${project.id}/terms/${termId}/pdf`,
                signedAt: new Date(),
                signedByIp: req.ip
            }
        });

        await createAuditLog({
            tenantId: project.tenantId,
            userId: user.id,
            action: "CUSTOM",
            entityType: "ProjectTerm",
            entityId: updated.id,
            ipAddress: getActorIp(req),
            userAgent: getActorAgent(req),
            metadata: { event: "PROJECT_TERM_SIGNED", projectId: project.id, signedAt: updated.signedAt }
        });

        return res.json(updated);
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
        console.error("Erro ao assinar termo", err);
        return res.status(500).json({ message: "Erro ao assinar termo" });
    }
});

const saveAccountabilitySchema = z.object({
    periodStart: z.string().optional(),
    periodEnd: z.string().optional(),
    executionSummary: z.string().optional(),
    audienceReached: z.number().int().min(0).optional(),
    amountSpent: z.number().min(0).optional(),
    documents: z.any().optional()
});

router.post("/:id/accountability", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;
        const data = saveAccountabilitySchema.parse(req.body);
        const project = await getProjectOr404(id);
        if (!project) return res.status(404).json({ message: "Projeto não encontrado" });
        if (!canAccessProjectWorkflow(project, user)) return res.status(403).json({ message: "Sem permissão" });
        if (!["APPROVED", "IN_EXECUTION", "COMPLETED"].includes(project.status)) {
            return res.status(400).json({ message: "Prestação de contas só é liberada após aprovação" });
        }

        const existing = await prisma.projectAccountability.findFirst({
            where: { projectId: id, status: { in: ["DRAFT", "ADJUSTMENTS_REQUIRED"] } },
            orderBy: { createdAt: "desc" }
        });

        const payload = {
            periodStart: data.periodStart ? new Date(data.periodStart) : undefined,
            periodEnd: data.periodEnd ? new Date(data.periodEnd) : undefined,
            executionSummary: data.executionSummary,
            audienceReached: data.audienceReached,
            amountSpent: data.amountSpent,
            documents: data.documents
        };

        const accountability = existing
            ? await prisma.projectAccountability.update({ where: { id: existing.id }, data: payload })
            : await prisma.projectAccountability.create({
                data: {
                    projectId: project.id,
                    tenantId: project.tenantId,
                    proponentId: project.proponentId,
                    ...payload
                }
            });

        await createAuditLog({
            tenantId: project.tenantId,
            userId: user.id,
            action: "CUSTOM",
            entityType: "ProjectAccountability",
            entityId: accountability.id,
            ipAddress: getActorIp(req),
            userAgent: getActorAgent(req),
            metadata: { event: existing ? "PROJECT_ACCOUNTABILITY_UPDATED" : "PROJECT_ACCOUNTABILITY_CREATED", projectId: project.id }
        });

        return res.status(existing ? 200 : 201).json(accountability);
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
        console.error("Erro ao salvar prestação de contas", err);
        return res.status(500).json({ message: "Erro ao salvar prestação de contas" });
    }
});

router.post("/:id/accountability/:accountabilityId/submit", authMiddleware, async (req, res) => {
    try {
        const { id, accountabilityId } = req.params;
        const user = req.user!;
        const project = await getProjectOr404(id);
        if (!project) return res.status(404).json({ message: "Projeto não encontrado" });
        if (project.proponentId !== user.id && user.role !== Role.MASTER) {
            return res.status(403).json({ message: "Apenas o proponente pode submeter prestação de contas" });
        }

        const accountability = await prisma.projectAccountability.findFirst({ where: { id: accountabilityId, projectId: id } });
        if (!accountability) return res.status(404).json({ message: "Prestação de contas não encontrada" });
        if (!["DRAFT", "ADJUSTMENTS_REQUIRED"].includes(accountability.status)) {
            return res.status(400).json({ message: "Prestação de contas não pode ser submetida neste status" });
        }

        const updated = await prisma.projectAccountability.update({
            where: { id: accountabilityId },
            data: { status: "SUBMITTED", submittedAt: new Date() }
        });

        await createAuditLog({
            tenantId: project.tenantId,
            userId: user.id,
            action: "CUSTOM",
            entityType: "ProjectAccountability",
            entityId: updated.id,
            ipAddress: getActorIp(req),
            userAgent: getActorAgent(req),
            metadata: { event: "PROJECT_ACCOUNTABILITY_SUBMITTED", projectId: project.id }
        });

        return res.json(updated);
    } catch (err) {
        console.error("Erro ao submeter prestação de contas", err);
        return res.status(500).json({ message: "Erro ao submeter prestação de contas" });
    }
});

const reviewAccountabilitySchema = z.object({
    status: z.enum(["UNDER_REVIEW", "APPROVED", "REJECTED", "ADJUSTMENTS_REQUIRED"]),
    reviewNotes: z.string().optional()
});

router.put("/:id/accountability/:accountabilityId/review", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.COLLABORATOR]), async (req, res) => {
    try {
        const { id, accountabilityId } = req.params;
        const user = req.user!;
        const data = reviewAccountabilitySchema.parse(req.body);
        const project = await getProjectOr404(id);
        if (!project) return res.status(404).json({ message: "Projeto não encontrado" });
        if (!canAdminProjectWorkflow(project, user)) return res.status(403).json({ message: "Sem permissão" });

        const accountability = await prisma.projectAccountability.findFirst({ where: { id: accountabilityId, projectId: id } });
        if (!accountability) return res.status(404).json({ message: "Prestação de contas não encontrada" });

        const updated = await prisma.projectAccountability.update({
            where: { id: accountabilityId },
            data: {
                status: data.status,
                reviewNotes: data.reviewNotes,
                reviewedBy: user.id,
                reviewedAt: new Date()
            }
        });

        if (data.status === "APPROVED" && project.status !== "COMPLETED") {
            await prisma.culturalProject.update({
                where: { id },
                data: {
                    status: "COMPLETED",
                    actualAudience: updated.audienceReached ?? undefined
                }
            });
        }

        await createAuditLog({
            tenantId: project.tenantId,
            userId: user.id,
            action: "CUSTOM",
            entityType: "ProjectAccountability",
            entityId: updated.id,
            ipAddress: getActorIp(req),
            userAgent: getActorAgent(req),
            metadata: { event: "PROJECT_ACCOUNTABILITY_REVIEWED", projectId: project.id, status: data.status }
        });
        await notifyProjectProponent(project, "Prestação de contas analisada", `Sua prestação de contas foi analisada com o status: <strong>${data.status}</strong>.`);

        return res.json(updated);
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
        console.error("Erro ao revisar prestação de contas", err);
        return res.status(500).json({ message: "Erro ao revisar prestação de contas" });
    }
});

router.get("/:id/terms/:termId/pdf", authMiddleware, async (req, res) => {
    try {
        const { id, termId } = req.params;
        const user = req.user!;
        const project = await getProjectOr404(id);
        if (!project) return res.status(404).json({ message: "Projeto não encontrado" });
        if (!canAccessProjectWorkflow(project, user)) return res.status(403).json({ message: "Sem permissão" });

        const term = await prisma.projectTerm.findFirst({ where: { id: termId, projectId: id } });
        if (!term) return res.status(404).json({ message: "Termo não encontrado" });
        return streamProjectTermPdf(res, term, project);
    } catch (err) {
        console.error("Erro ao gerar PDF do termo", err);
        return res.status(500).json({ message: "Erro ao gerar PDF do termo" });
    }
});

router.get("/:id/accountability/:accountabilityId/pdf", authMiddleware, async (req, res) => {
    try {
        const { id, accountabilityId } = req.params;
        const user = req.user!;
        const project = await getProjectOr404(id);
        if (!project) return res.status(404).json({ message: "Projeto não encontrado" });
        if (!canAccessProjectWorkflow(project, user)) return res.status(403).json({ message: "Sem permissão" });

        const accountability = await prisma.projectAccountability.findFirst({ where: { id: accountabilityId, projectId: id } });
        if (!accountability) return res.status(404).json({ message: "Prestação de contas não encontrada" });
        return streamProjectAccountabilityPdf(res, accountability, project);
    } catch (err) {
        console.error("Erro ao gerar PDF da prestação de contas", err);
        return res.status(500).json({ message: "Erro ao gerar PDF da prestação de contas" });
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

// Endpoint de Análise IA Manual
router.post("/:id/analyze", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const project = await prisma.culturalProject.findUnique({ where: { id } });
        if (!project) return res.status(404).json({ message: "Projeto não encontrado" });

        // Verificar permissão
        if (user.role !== Role.MASTER && project.tenantId !== user.tenantId) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        // Chamar análise
        const analysis = await analyzeProjectWithAI(id, project.tenantId);

        if (!analysis) {
            return res.status(500).json({ message: "Falha ao gerar análise IA" });
        }

        return res.json(analysis);
    } catch (err) {
        console.error("Erro no endpoint de análise manual", err);
        return res.status(500).json({ message: "Erro ao processar análise" });
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
                        accessibilityProvider: { select: { id: true, name: true, email: true } }
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
        const user = req.user!;
        const project = await prisma.culturalProject.findUnique({
            where: { id },
            include: { publicNotice: true, user: true, tenant: true }
        });

        if (!project) return res.status(404).json({ message: "Projeto não encontrado" });
        if (project.eventId) return res.status(400).json({ message: "Projeto já publicado como evento" });
        
        const isOwner = project.proponentId === user.id;
        const isAdmin = user.role === Role.ADMIN && project.tenantId === user.tenantId;
        const isMaster = user.role === Role.MASTER;
        if (!isOwner && !isAdmin && !isMaster) {
            return res.status(403).json({ message: "Sem permissao" });
        }

        // SECURITY LOCK: Only APPROVED projects can be published to the agenda
        if (project.status !== "APPROVED") {
            return res.status(403).json({ 
                message: "Apenas projetos com status 'APROVADO' podem ser publicados na Agenda Cultural." 
            });
        }

        // Find or create default category
        let category = await prisma.category.findFirst({
            where: { type: "EVENT", tenantId: project.tenantId }
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
                categoryId: category.id,
                startDate: project.startDate || new Date(),
                endDate: project.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                location: project.targetRegion || "Local a definir",
                status: "PUBLISHED", // Published directly to agenda
                coverUrl: "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?q=80&w=1000&auto=format&fit=crop", 
                format: "PRESENTIAL",
                visibility: "PUBLIC",
                producerName: project.user?.name || "Produtor Cultural",
                tenantId: project.tenantId
            }
        });

        // Auto-create a default Free Ticket
        await prisma.ticket.create({
            data: {
                name: "Ingresso Gratuito",
                description: "Acesso via Projeto Cultural",
                price: 0,
                quantity: project.expectedAudience || 100,
                sold: 0,
                status: "ACTIVE",
                eventId: event.id
            }
        });

        // Link back and update status to IN_EXECUTION
        await prisma.culturalProject.update({
            where: { id },
            data: {
                eventId: event.id,
                status: "IN_EXECUTION"
            }
        });

        return res.json({ 
            message: "Evento ativado e publicado na agenda!", 
            eventId: event.id,
            slug: project.tenant.slug 
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Erro ao publicar evento" });
    }
});

// Anexar Nota Fiscal
router.post("/:id/invoice", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { notaFiscalUrl, notaFiscalNumber, notaFiscalDate } = req.body;
        const user = req.user!;

        const project = await prisma.culturalProject.findUnique({
            where: { id }
        });

        if (!project) return res.status(404).json({ message: "Projeto não encontrado" });

        const isOwner = project.proponentId === user.id;
        const isAdmin = user.role === Role.ADMIN && project.tenantId === user.tenantId;
        const isMaster = user.role === Role.MASTER;

        if (!isOwner && !isAdmin && !isMaster) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        const updated = await prisma.culturalProject.update({
            where: { id },
            data: {
                notaFiscalUrl,
                notaFiscalNumber,
                notaFiscalDate: notaFiscalDate ? new Date(notaFiscalDate) : new Date()
            }
        });

        return res.json({ message: "Nota Fiscal anexada com sucesso", project: updated });
    } catch (err) {
        console.error("Erro ao anexar NF:", err);
        return res.status(500).json({ message: "Erro ao anexar NF" });
    }
});

export default router;
