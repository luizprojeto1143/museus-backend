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
                project: { select: { id: true, title: true } },
                provider: { select: { id: true, name: true } }
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
                    project: { select: { id: true, title: true } },
                    provider: { select: { id: true, name: true } }
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
            include: { project: true, provider: true, tenant: { select: { id: true, name: true } } }
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
    tenantId: z.string()
});

router.post("/request", authMiddleware, async (req, res) => {
    try {
        const data = requestSchema.parse(req.body);
        const targetTenantId = req.user!.role === Role.MASTER ? data.tenantId : req.user!.tenantId;
        if (!targetTenantId) return res.status(400).json({ message: "Tenant ID não encontrado" });

        const execution = await prisma.accessibilityExecution.create({
            data: { ...data, requestedBy: req.user!.id, tenantId: targetTenantId, status: "PENDING" }
        });
        return res.status(201).json(execution);
    } catch (err) {
        return res.status(500).json({ message: "Erro ao solicitar serviço" });
    }
});

// Aprovar solicitação
router.put("/:id/approve", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { approvedBudget } = req.body;
        const execution = await prisma.accessibilityExecution.update({
            where: { id: req.params.id },
            data: { status: "APPROVED", approvedAt: new Date(), approvedBy: req.user!.id, approvedBudget }
        });
        return res.json(execution);
    } catch (err) {
        return res.status(500).json({ message: "Erro ao aprovar" });
    }
});

// Registrar entrega
router.put("/:id/deliver", authMiddleware, async (req, res) => {
    try {
        const { deliverables, executionNotes } = req.body;
        const updated = await prisma.accessibilityExecution.update({
            where: { id: req.params.id },
            data: { deliverables, executionNotes, executedAt: new Date(), status: "DELIVERED" }
        });
        return res.json(updated);
    } catch (err) {
        return res.status(500).json({ message: "Erro ao registrar entrega" });
    }
});

// Validar execução
router.put("/:id/validate", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { validationStatus, validationNotes } = req.body;
        const execution = await prisma.accessibilityExecution.findUnique({ where: { id: req.params.id } });
        if (!execution) return res.status(404).json({ message: "Execução não encontrada" });

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
    } catch (err) {
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
            include: { provider: true, tenant: true }
        });

        if (!execution || !execution.provider) return res.status(404).json({ message: "Execução ou prestador não encontrado" });
        if (user.role !== Role.MASTER && execution.tenantId !== user.tenantId) return res.status(403).json({ message: "Sem permissão" });
        if (!execution.approvedBudget) return res.status(400).json({ message: "Valor aprovado não definido" });

        // Stripe Split Payment Verification
        if (!execution.provider.stripeConnectId) {
            return res.status(400).json({ 
                message: "O prestador ainda não configurou sua conta Stripe Connect. Solicite ao prestador que acesse o painel e configure os recebimentos." 
            });
        }

        const { stripeService } = await import("../services/stripeService.js");
        const amountCents = Math.round(Number(execution.approvedBudget) * 100);
        const platformFeeCents = Math.round(amountCents * 0.10); // 10% comissão plataforma

        const stripeCustomerId = await stripeService.createCustomer({
            name: user.name || execution.tenant.name,
            email: user.email,
            userId: user.id
        });

        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

        const session = await stripeService.createSplitPaymentSession({
            customerId: stripeCustomerId,
            amount: amountCents,
            description: `Serviço de Acessibilidade: ${execution.serviceType}`,
            connectedAccountId: execution.provider.stripeConnectId || '', 
            applicationFeeAmount: platformFeeCents,
            successUrl: `${frontendUrl}/accessibility/success?id=${id}`,
            cancelUrl: `${frontendUrl}/accessibility/cancel?id=${id}`
        });

        // Save session ID to execution record for webhook tracking
        await prisma.accessibilityExecution.update({
            where: { id },
            data: { stripePaymentIntentId: session.id }
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

export default router;
