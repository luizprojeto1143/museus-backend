import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role, AccessibilityServiceType } from "@prisma/client";
import { z } from "zod";

const router = Router();

// Lista execuções de acessibilidade do tenant
router.get("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === Role.MASTER ? (req.query.tenantId as string) : user.tenantId;
        const { status, projectId, providerId, serviceType } = req.query;

        if (!tenantId) {
            return res.status(400).json({ message: "tenantId é obrigatório" });
        }

        const where: any = { tenantId };
        if (status) where.status = status;
        if (projectId) where.projectId = projectId;
        if (providerId) where.providerId = providerId;
        if (serviceType) where.serviceType = serviceType;

        const executions = await prisma.accessibilityExecution.findMany({
            where,
            orderBy: { createdAt: "desc" },
            include: {
                project: { select: { id: true, title: true } },
                provider: { select: { id: true, name: true } }
            }
        });

        return res.json(executions);
    } catch (err) {
        console.error("Erro ao listar execuções", err);
        return res.status(500).json({ message: "Erro ao listar execuções" });
    }
});

// Dashboard de acessibilidade
router.get("/dashboard", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === Role.MASTER ? (req.query.tenantId as string) : user.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: "tenantId é obrigatório" });
        }

        const [byStatus, byService, recentExecutions] = await Promise.all([
            prisma.accessibilityExecution.groupBy({
                by: ["status"],
                where: { tenantId },
                _count: true
            }),
            prisma.accessibilityExecution.groupBy({
                by: ["serviceType"],
                where: { tenantId },
                _count: true
            }),
            prisma.accessibilityExecution.findMany({
                where: { tenantId },
                orderBy: { createdAt: "desc" },
                take: 10,
                include: {
                    project: { select: { id: true, title: true } },
                    provider: { select: { id: true, name: true } }
                }
            })
        ]);

        return res.json({
            byStatus,
            byService,
            recentExecutions
        });
    } catch (err) {
        console.error("Erro ao carregar dashboard", err);
        return res.status(500).json({ message: "Erro ao carregar dashboard" });
    }
});

// Detalhes da execução
router.get("/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const execution = await prisma.accessibilityExecution.findUnique({
            where: { id },
            include: {
                project: true,
                provider: true,
                tenant: { select: { id: true, name: true } }
            }
        });

        if (!execution) {
            return res.status(404).json({ message: "Execução não encontrada" });
        }

        if (user.role !== Role.MASTER && execution.tenantId !== user.tenantId) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        return res.json(execution);
    } catch (err) {
        console.error("Erro ao buscar execução", err);
        return res.status(500).json({ message: "Erro ao buscar execução" });
    }
});

// Solicitar serviço de acessibilidade
const requestSchema = z.object({
    serviceType: z.nativeEnum(AccessibilityServiceType),
    projectId: z.string().optional(),
    eventId: z.string().optional(),
    requestNotes: z.string().optional(),
    tenantId: z.string()
});

router.post("/request", authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const data = requestSchema.parse(req.body);

        // Security: Enforce tenantId from user token if not Master
        const targetTenantId = user.role === Role.MASTER ? data.tenantId : user.tenantId;

        if (!targetTenantId) {
            return res.status(400).json({ message: "Tenant ID não encontrado" });
        }

        // Verificar feature habilitada
        const tenant = await prisma.tenant.findUnique({
            where: { id: targetTenantId },
            select: { featureAccessibilityMgmt: true }
        });

        if (!tenant?.featureAccessibilityMgmt && user.role !== Role.MASTER) {
            return res.status(403).json({ message: "Módulo de gestão de acessibilidade não habilitado" });
        }

        const execution = await prisma.accessibilityExecution.create({
            data: {
                serviceType: data.serviceType,
                projectId: data.projectId,
                eventId: data.eventId,
                requestNotes: data.requestNotes,
                requestedBy: user.id,
                tenantId: targetTenantId,
                status: "PENDING"
            }
        });

        return res.status(201).json(execution);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
        }
        console.error("Erro ao solicitar serviço", err);
        return res.status(500).json({ message: "Erro ao solicitar serviço" });
    }
});

// Aprovar solicitação
router.put("/:id/approve", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const { approvedBudget } = req.body;
        const user = req.user!;

        const execution = await prisma.accessibilityExecution.findUnique({ where: { id } });
        if (!execution) {
            return res.status(404).json({ message: "Execução não encontrada" });
        }

        if (user.role !== Role.MASTER && execution.tenantId !== user.tenantId) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        const updated = await prisma.accessibilityExecution.update({
            where: { id },
            data: {
                status: "APPROVED",
                approvedAt: new Date(),
                approvedBy: user.id,
                approvedBudget
            }
        });

        return res.json(updated);
    } catch (err) {
        console.error("Erro ao aprovar", err);
        return res.status(500).json({ message: "Erro ao aprovar" });
    }
});

// Atribuir prestador
router.put("/:id/assign", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const { providerId } = req.body;
        const user = req.user!;

        const execution = await prisma.accessibilityExecution.findUnique({ where: { id } });
        if (!execution) {
            return res.status(404).json({ message: "Execução não encontrada" });
        }

        if (user.role !== Role.MASTER && execution.tenantId !== user.tenantId) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        // Verificar se prestador existe
        const provider = await prisma.accessibilityProvider.findUnique({ where: { id: providerId } });
        if (!provider) {
            return res.status(404).json({ message: "Prestador não encontrado" });
        }

        const updated = await prisma.accessibilityExecution.update({
            where: { id },
            data: {
                providerId,
                status: "IN_PROGRESS"
            }
        });

        return res.json(updated);
    } catch (err) {
        console.error("Erro ao atribuir prestador", err);
        return res.status(500).json({ message: "Erro ao atribuir prestador" });
    }
});

// Registrar entrega
router.put("/:id/deliver", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { deliverables, executionNotes } = req.body;
        const user = req.user!;

        const execution = await prisma.accessibilityExecution.findUnique({ where: { id } });
        if (!execution) {
            return res.status(404).json({ message: "Execução não encontrada" });
        }

        // Só o prestador atribuído ou admin pode registrar entrega
        const isProvider = execution.providerId && user.id === execution.providerId;
        const isAdmin = user.role === Role.ADMIN && execution.tenantId === user.tenantId;
        const isMaster = user.role === Role.MASTER;

        if (!isProvider && !isAdmin && !isMaster) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        const updated = await prisma.accessibilityExecution.update({
            where: { id },
            data: {
                deliverables,
                executionNotes,
                executedAt: new Date(),
                status: "DELIVERED"
            }
        });

        return res.json(updated);
    } catch (err) {
        console.error("Erro ao registrar entrega", err);
        return res.status(500).json({ message: "Erro ao registrar entrega" });
    }
});

// Validar execução
router.put("/:id/validate", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const { validationStatus, validationNotes } = req.body;
        const user = req.user!;

        const execution = await prisma.accessibilityExecution.findUnique({ where: { id } });
        if (!execution) {
            return res.status(404).json({ message: "Execução não encontrada" });
        }

        if (user.role !== Role.MASTER && execution.tenantId !== user.tenantId) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        const validStatuses = ["APPROVED", "NEEDS_REVISION", "REJECTED"];
        if (!validStatuses.includes(validationStatus)) {
            return res.status(400).json({ message: "Status de validação inválido" });
        }

        // Atualizar contador do prestador se aprovado
        if (validationStatus === "APPROVED" && execution.providerId) {
            await prisma.accessibilityProvider.update({
                where: { id: execution.providerId },
                data: { completedJobs: { increment: 1 } }
            });
        }

        const updated = await prisma.accessibilityExecution.update({
            where: { id },
            data: {
                validationStatus,
                validationNotes,
                validatedAt: new Date(),
                validatedBy: user.id,
                status: validationStatus === "APPROVED" ? "VALIDATED" :
                    validationStatus === "NEEDS_REVISION" ? "IN_PROGRESS" : "REJECTED"
            }
        });

        return res.json(updated);
    } catch (err) {
        console.error("Erro ao validar", err);
        return res.status(500).json({ message: "Erro ao validar" });
    }
});

export default router;
