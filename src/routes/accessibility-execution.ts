import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role, AccessibilityServiceType, PlatformFeeSource } from "@prisma/client";
import { z } from "zod";
import { checkEntityOwnership, assertTenantOwnership } from "../utils/ownership.js";
import { getPlatformFee } from "../services/fee.service.js";

const router = Router();

async function validateAccessibilityTargets(projectId: string | undefined, eventId: string | undefined, tenantId: string) {
    if (projectId) {
        const project = await prisma.culturalProject.findFirst({ where: { id: projectId, tenantId } });
        if (!project) {
            throw Object.assign(new Error("Projeto cultural nao encontrado neste tenant"), { status: 404 });
        }
    }

    if (eventId) {
        const event = await prisma.event.findFirst({ where: { id: eventId, tenantId, deletedAt: null } });
        if (!event) {
            throw Object.assign(new Error("Evento nao encontrado neste tenant"), { status: 404 });
        }
    }
}

// Lista execuções de acessibilidade do tenant
router.get("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === Role.MASTER ? (req.query.tenantId as string) : user.tenantId;
        const { status, projectId, providerId, serviceType } = req.query;

        if (!tenantId) return res.status(400).json({ message: "tenantId é obrigatório" });

        const where: any = { tenantId };
        if (status) where.status = status;
        if (projectId) where.projectId = projectId;
        if (providerId) where.providerId = providerId;
        if (serviceType) where.serviceType = serviceType;

        const executions = await prisma.accessibilityExecution.findMany({
            where,
            orderBy: { createdAt: "desc" },
            include: {
                culturalProject: { select: { id: true, title: true } },
                accessibilityProvider: { select: { id: true, name: true } }
            }
        });
        return res.json(executions);
    } catch (err) {
        return res.status(500).json({ message: "Erro ao listar execuções" });
    }
});

// Dashboard de acessibilidade
router.get("/dashboard", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === Role.MASTER ? (req.query.tenantId as string) : user.tenantId;
        if (!tenantId) return res.status(400).json({ message: "tenantId é obrigatório" });

        const [byStatus, byService, recentExecutions] = await Promise.all([
            prisma.accessibilityExecution.groupBy({ by: ["status"], where: { tenantId }, _count: true }),
            prisma.accessibilityExecution.groupBy({ by: ["serviceType"], where: { tenantId }, _count: true }),
            prisma.accessibilityExecution.findMany({
                where: { tenantId }, orderBy: { createdAt: "desc" }, take: 10,
                include: {
                    culturalProject: { select: { id: true, title: true } },
                    accessibilityProvider: { select: { id: true, name: true } }
                }
            })
        ]);
        return res.json({ byStatus, byService, recentExecutions });
    } catch (err) {
        return res.status(500).json({ message: "Erro ao carregar dashboard" });
    }
});

// Detalhes da execução
router.get("/:id", authMiddleware, async (req, res) => {
    try {
        const execution = await prisma.accessibilityExecution.findUnique({
            where: { id: req.params.id },
            include: { culturalProject: true, accessibilityProvider: true, tenant: { select: { id: true, name: true } } }
        });
        if (!execution) return res.status(404).json({ message: "Execução não encontrada" });
        if (req.user!.role !== Role.MASTER && execution.tenantId !== req.user!.tenantId) return res.status(403).json({ message: "Sem permissão" });
        return res.json(execution);
    } catch (err) {
        return res.status(500).json({ message: "Erro ao buscar execução" });
    }
});

// Solicitar serviço
const requestSchema = z.object({
    serviceType: z.nativeEnum(AccessibilityServiceType),
    projectId: z.string().optional(),
    eventId: z.string().optional(),
    requestNotes: z.string().optional(),
    tenantId: z.string().optional(),
    providerId: z.string().optional().nullable(),
    approvedBudget: z.any().optional().nullable(),
    status: z.string().optional(),
    deliverables: z.any().optional().nullable(),
    validationStatus: z.string().optional().nullable()
});

async function createAccessibilityExecution(req: any, res: any) {
    try {
        const data = requestSchema.parse(req.body);
        const targetTenantId = req.user!.role === Role.MASTER ? data.tenantId : req.user!.tenantId;
        if (!targetTenantId) return res.status(400).json({ message: "Tenant ID não encontrado" });

        await validateAccessibilityTargets(data.projectId, data.eventId, targetTenantId);

        const execution = await prisma.accessibilityExecution.create({
            data: {
                serviceType: data.serviceType,
                projectId: data.projectId || null,
                eventId: data.eventId || null,
                requestNotes: data.requestNotes,
                providerId: data.providerId || null,
                approvedBudget: data.approvedBudget ? Number(data.approvedBudget) : null,
                deliverables: data.deliverables || undefined,
                validationStatus: data.validationStatus || null,
                requestedBy: req.user!.id,
                tenantId: targetTenantId,
                status: data.status || "PENDING"
            } as any
        });
        return res.status(201).json(execution);
    } catch (err: any) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ message: "Dados invalidos", errors: err.errors });
        }
        if (err.status) return res.status(err.status).json({ message: err.message });
        return res.status(500).json({ message: "Erro ao solicitar serviço" });
    }
}

router.post("/", authMiddleware, createAccessibilityExecution);
router.post("/request", authMiddleware, createAccessibilityExecution);

router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const data = requestSchema.partial().parse(req.body);
        await assertTenantOwnership({ model: 'accessibilityExecution', id: req.params.id, user: req.user! });

        if (data.projectId || data.eventId) {
            const targetTenantId = req.user!.role === Role.MASTER ? req.body.tenantId : req.user!.tenantId;
            if (!targetTenantId) return res.status(400).json({ message: "Tenant ID não encontrado" });
            await validateAccessibilityTargets(data.projectId || undefined, data.eventId || undefined, targetTenantId);
        }

        const updated = await prisma.accessibilityExecution.update({
            where: { id: req.params.id },
            data: {
                serviceType: data.serviceType,
                projectId: data.projectId === undefined ? undefined : data.projectId || null,
                eventId: data.eventId === undefined ? undefined : data.eventId || null,
                requestNotes: data.requestNotes,
                providerId: data.providerId === undefined ? undefined : data.providerId || null,
                approvedBudget: data.approvedBudget === undefined ? undefined : data.approvedBudget ? Number(data.approvedBudget) : null,
                deliverables: data.deliverables === undefined ? undefined : data.deliverables,
                validationStatus: data.validationStatus === undefined ? undefined : data.validationStatus,
                status: data.status
            } as any
        });
        return res.json(updated);
    } catch (err: any) {
        if (err instanceof z.ZodError) return res.status(400).json({ message: "Dados invalidos", errors: err.errors });
        if (err.status) return res.status(err.status).json({ message: err.message });
        return res.status(500).json({ message: "Erro ao atualizar execução" });
    }
});

// Aprovar solicitação
router.put("/:id/approve", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { approvedBudget } = req.body;
        await assertTenantOwnership({ model: 'accessibilityExecution', id: req.params.id, user: req.user! });

        const execution = await prisma.accessibilityExecution.update({
            where: { id: req.params.id },
            data: { status: "APPROVED", approvedAt: new Date(), approvedBy: req.user!.id, approvedBudget }
        });
        return res.json(execution);
    } catch (err: any) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        return res.status(500).json({ message: "Erro ao aprovar" });
    }
});

// Registrar entrega
router.put("/:id/deliver", authMiddleware, async (req, res) => {
    try {
        const { deliverables, executionNotes } = req.body;
        const execution = await assertTenantOwnership({ model: 'accessibilityExecution', id: req.params.id, user: req.user! });

        // Verificação adicional de permissão: ou é o prestador designado ou é admin do tenant
        const isProvider = execution.providerId && await prisma.accessibilityProvider.findFirst({
            where: { id: execution.providerId, userId: req.user!.id }
        });
        const isTenantAdmin = req.user!.role === Role.MASTER || (req.user!.role === Role.ADMIN && execution.tenantId === req.user!.tenantId);

        if (!isProvider && !isTenantAdmin) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        const updated = await prisma.accessibilityExecution.update({
            where: { id: req.params.id },
            data: { deliverables, executionNotes, executedAt: new Date(), status: "DELIVERED" }
        });
        return res.json(updated);
    } catch (err: any) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        return res.status(500).json({ message: "Erro ao registrar entrega" });
    }
});

// Validar execução
router.put("/:id/validate", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { validationStatus, validationNotes } = req.body;
        const execution = await assertTenantOwnership({ model: 'accessibilityExecution', id: req.params.id, user: req.user! });
        
        // Incluir o accessibilityProvider para uso posterior
        const provider = execution.providerId ? await prisma.accessibilityProvider.findUnique({
            where: { id: execution.providerId }
        }) : null;
        execution.accessibilityProvider = provider;

        if (validationStatus === "APPROVED" && execution.providerId) {
            await prisma.accessibilityProvider.update({
                where: { id: execution.providerId },
                data: { completedJobs: { increment: 1 } }
            });
        }

        const updated = await prisma.accessibilityExecution.update({
            where: { id: req.params.id },
            data: {
                validationStatus, validationNotes, validatedAt: new Date(), validatedBy: req.user!.id,
                status: validationStatus === "APPROVED" ? "VALIDATED" : validationStatus === "NEEDS_REVISION" ? "IN_PROGRESS" : "REJECTED"
            }
        });
        return res.json(updated);
    } catch (err: any) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        return res.status(500).json({ message: "Erro ao validar" });
    }
});

// Criar pagamento via STRIPE (com Split)
router.post("/:id/pay", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const execution = await prisma.accessibilityExecution.findUnique({
            where: { id },
            include: { accessibilityProvider: true, tenant: true }
        });

        if (!execution || !execution.accessibilityProvider) return res.status(404).json({ message: "Execução ou prestador não encontrado" });
        if (user.role !== Role.MASTER && execution.tenantId !== user.tenantId) return res.status(403).json({ message: "Sem permissão" });
        if (!execution.approvedBudget) return res.status(400).json({ message: "Valor aprovado não definido" });

        // Stripe Split Payment Verification
        if (!(execution as any).accessibilityProvider?.stripeConnectId) {
            return res.status(400).json({ 
                message: "O prestador ainda não configurou sua conta Stripe Connect. Solicite ao prestador que acesse o painel e configure os recebimentos." 
            });
        }

        const { stripeService } = await import("../services/stripeService.js");
        const amountCents = Math.round(Number(execution.approvedBudget) * 100);

        // Sprint 15: Calcular taxa via Central de Taxas (ACCESSIBILITY)
        const feeResult = await getPlatformFee({
            tenantId: execution.tenantId,
            sourceType: PlatformFeeSource.ACCESSIBILITY,
            amountCents
        });
        const platformFeeCents = feeResult.platformFeeCents;

        const stripeCustomerId = await stripeService.createCustomer({
            name: user.name || execution.tenant.name,
            email: user.email,
            userId: user.id
        });

        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

        const session = await stripeService.createSplitPaymentSession({
            customerId: stripeCustomerId,
            amount: feeResult.buyerPaysCents, // BUYER paga base + taxa
            description: `Serviço de Acessibilidade: ${execution.serviceType}`,
            connectedAccountId: (execution as any).accessibilityProvider.stripeConnectId, 
            applicationFeeAmount: platformFeeCents,
            successUrl: `${frontendUrl}/accessibility/success?id=${id}`,
            cancelUrl: `${frontendUrl}/accessibility/cancel?id=${id}`
        });

        // Save session ID + fee snapshot details to execution record for webhook tracking
        await prisma.accessibilityExecution.update({
            where: { id },
            data: { 
                stripePaymentIntentId: session.id,
                // Sprint 15 â€” fee snapshot
                feeConfigId: feeResult.configId,
                platformFeeAmountCents: platformFeeCents
            }
        });

        return res.json({
            checkoutUrl: session.url,
            sessionId: session.id
        });

    } catch (err) {
        console.error("Erro ao processar pagamento Stripe", err);
        return res.status(500).json({ message: "Erro ao processar pagamento" });
    }
});

// Upload Nota Fiscal
router.put("/:id/nota-fiscal", authMiddleware, async (req, res) => {
    try {
        const { notaFiscalUrl, notaFiscalNumber, notaFiscalDate } = req.body;
        await assertTenantOwnership({ model: 'accessibilityExecution', id: req.params.id, user: req.user! });

        const updated = await prisma.accessibilityExecution.update({
            where: { id: req.params.id },
            data: { notaFiscalUrl, notaFiscalNumber, notaFiscalDate: notaFiscalDate ? new Date(notaFiscalDate) : null }
        });
        return res.json(updated);
    } catch (err: any) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        return res.status(500).json({ message: "Erro ao atualizar Nota Fiscal" });
    }
});

// Upload Recibo de Pagamento (Comprovante)
router.put("/:id/payment-receipt", authMiddleware, async (req, res) => {
    try {
        const { paymentReceiptUrl } = req.body;
        await assertTenantOwnership({ model: 'accessibilityExecution', id: req.params.id, user: req.user! });

        const updated = await prisma.accessibilityExecution.update({
            where: { id: req.params.id },
            data: { paymentReceiptUrl }
        });
        return res.json(updated);
    } catch (err: any) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        return res.status(500).json({ message: "Erro ao atualizar Comprovante" });
    }
});

export default router;

