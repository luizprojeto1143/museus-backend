import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role, AccessibilityServiceType } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcrypt";
import { mailService } from "../services/email.js";

const router = Router();

// Lista prestadores
router.get("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === Role.MASTER ? (req.query.tenantId as string) : user.tenantId;
        const { active, serviceType } = req.query;

        const where: any = {};

        // Prestadores do tenant ou globais (tenantId = null)
        if (tenantId) {
            where.OR = [
                { tenantId },
                { tenantId: null }
            ];
        }

        if (active !== undefined) where.active = active === "true";
        if (serviceType) where.services = { has: serviceType as AccessibilityServiceType };

        const providers = await prisma.accessibilityProvider.findMany({
            where,
            orderBy: { name: "asc" },
            include: {
                _count: { select: { executions: true } }
            }
        });

        return res.json(providers);
    } catch (err) {
        console.error("Erro ao listar prestadores", err);
        return res.status(500).json({ message: "Erro ao listar prestadores" });
    }
});

// Get current provider info (for the logged in user)
router.get("/me", authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const provider = await prisma.accessibilityProvider.findUnique({
            where: { userId: user.id }
        });

        if (!provider) {
            return res.status(404).json({ message: "Perfil de prestador não encontrado para este usuário" });
        }

        return res.json(provider);
    } catch (err) {
        console.error("Erro ao buscar meu perfil de prestador", err);
        return res.status(500).json({ message: "Erro ao buscar perfil" });
    }
});

// Get current provider stats
router.get("/me/stats", authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const provider = await prisma.accessibilityProvider.findUnique({
            where: { userId: user.id }
        });

        if (!provider) {
            return res.status(404).json({ message: "Perfil de prestador não encontrado" });
        }

        const stats = {
            totalExecutions: await prisma.accessibilityExecution.count({ where: { providerId: provider.id } }),
            completedExecutions: await prisma.accessibilityExecution.count({ where: { providerId: provider.id, status: "VALIDATED" } }),
            activeConversations: await prisma.conversation.count({
                where: {
                    providerId: provider.id,
                    status: "OPEN"
                }
            }),
            pendingQuotes: await prisma.conversation.count({
                where: {
                    providerId: provider.id,
                    messages: {
                        none: {
                            senderType: "PROVIDER"
                        }
                    }
                }
            }),
            hasStripeConnect: !!provider.stripeConnectId
        };

        return res.json(stats);
    } catch (err) {
        console.error("Erro ao buscar estatísticas", err);
        return res.status(500).json({ message: "Erro ao buscar estatísticas" });
    }
});

// Detalhes do prestador
router.get("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), async (req, res) => {
    try {
        const { id } = req.params;

        const provider = await prisma.accessibilityProvider.findUnique({
            where: { id },
            include: {
                executions: {
                    orderBy: { createdAt: "desc" },
                    take: 20,
                    include: {
                        project: { select: { id: true, title: true } }
                    }
                },
                _count: { select: { executions: true } }
            }
        });

        if (!provider) {
            return res.status(404).json({ message: "Prestador não encontrado" });
        }

        return res.json(provider);
    } catch (err) {
        console.error("Erro ao buscar prestador", err);
        return res.status(500).json({ message: "Erro ao buscar prestador" });
    }
});

// Criar prestador
const createProviderSchema = z.object({
    name: z.string().min(1, "Nome é obrigatório"),
    document: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    description: z.string().optional(),
    services: z.array(z.nativeEnum(AccessibilityServiceType)).min(1, "Pelo menos um serviço é obrigatório"),
    tenantId: z.string().optional(), // Se não informado, é prestador global
    password: z.string().optional() // Obrigatório no frontend ao criar
});

router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const data = createProviderSchema.parse(req.body);

        // Se não for MASTER, precisa ter feature habilitada
        if (user.role !== Role.MASTER) {
            if (!user.tenantId) {
                return res.status(400).json({ message: "tenantId é obrigatório" });
            }
            const tenant = await prisma.tenant.findUnique({
                where: { id: user.tenantId },
                select: { featureProviders: true }
            });

            if (!tenant?.featureProviders) {
                return res.status(403).json({ message: "Módulo de prestadores não habilitado" });
            }
        }

        // Se enviou senha (e deve enviar, pois email é pro login), cria o usuário
        const targetTenantId = user.role === Role.MASTER && data.tenantId ? data.tenantId : user.tenantId;

        // Vamos usar transação para garantir as duas criações
        const provider = await prisma.$transaction(async (tx) => {
            let userId = null;
            if (data.email && data.password && data.name) {
                // Checar se e-mail já existe
                const existingUser = await tx.user.findUnique({ where: { email: data.email } });
                if (existingUser) {
                    throw new Error("E-mail já está em uso por outro usuário do sistema.");
                }

                const hashedPassword = await bcrypt.hash(data.password, 10);
                const newUser = await tx.user.create({
                    data: {
                        name: data.name,
                        email: data.email,
                        password: hashedPassword,
                        role: Role.PRODUCER,
                        tenantId: targetTenantId
                    }
                });
                userId = newUser.id;
            }

            return await tx.accessibilityProvider.create({
                data: {
                    name: data.name,
                    document: data.document,
                    email: data.email,
                    phone: data.phone,
                    description: data.description,
                    services: data.services,
                    tenantId: targetTenantId,
                    userId: userId
                }
            });
        });

        return res.status(201).json(provider);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
        }
        console.error("Erro ao criar prestador", err);
        return res.status(500).json({ message: "Erro ao criar prestador" });
    }
});

// Atualizar prestador
router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const existing = await prisma.accessibilityProvider.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ message: "Prestador não encontrado" });
        }

        // Verificar permissão: Se for PRODUCER, só pode editar o próprio perfil
        if (user.role === Role.PRODUCER) {
            if (existing.userId !== user.id) {
                return res.status(403).json({ message: "Você não tem permissão para editar este perfil" });
            }
        } else if (user.role !== Role.MASTER && existing.tenantId !== user.tenantId) {
            // Regra Admin: só edita se for do mesmo museu (tenant)
            return res.status(403).json({ message: "Sem permissão" });
        }

        const { name, document, email, phone, description, services, active, rating } = req.body;

        const provider = await prisma.accessibilityProvider.update({
            where: { id },
            data: {
                ...(name && { name }),
                ...(document !== undefined && { document }),
                ...(email !== undefined && { email }),
                ...(phone !== undefined && { phone }),
                ...(description !== undefined && { description }),
                ...(services && { services }),
                ...(active !== undefined && user.role !== Role.PRODUCER ? { active } : {}), // Produtor não altera o status 'active'
                ...(rating !== undefined && user.role !== Role.PRODUCER ? { rating } : {})
            }
        });

        return res.json(provider);
    } catch (err) {
        console.error("Erro ao atualizar prestador", err);
        return res.status(500).json({ message: "Erro ao atualizar prestador" });
    }
});

// Verificar prestador
router.put("/:id/verify", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;

        const provider = await prisma.accessibilityProvider.update({
            where: { id },
            data: {
                verifiedAt: new Date(),
                active: true
            }
        });

        return res.json(provider);
    } catch (err) {
        console.error("Erro ao verificar prestador", err);
        return res.status(500).json({ message: "Erro ao verificar prestador" });
    }
});

// Deletar prestador
router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const existing = await prisma.accessibilityProvider.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ message: "Prestador não encontrado" });
        }

        if (user.role !== Role.MASTER && existing.tenantId !== user.tenantId) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        // Verificar se tem execuções em andamento
        const activeExecutions = await prisma.accessibilityExecution.count({
            where: {
                providerId: id,
                status: { in: ["APPROVED", "IN_PROGRESS"] }
            }
        });

        if (activeExecutions > 0) {
            return res.status(400).json({
                message: "Prestador possui execuções em andamento, não pode ser excluído"
            });
        }

        await prisma.accessibilityProvider.delete({ where: { id } });
        return res.status(204).send();
    } catch (err) {
        console.error("Erro ao deletar prestador", err);
        return res.status(500).json({ message: "Erro ao deletar prestador" });
    }
});

// Histórico de serviços do prestador
router.get("/:id/history", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;

        const executions = await prisma.accessibilityExecution.findMany({
            where: { providerId: id },
            orderBy: { createdAt: "desc" },
            include: {
                project: { select: { id: true, title: true } },
                tenant: { select: { id: true, name: true } }
            }
        });

        // Estatísticas
        const stats = {
            total: executions.length,
            completed: executions.filter(e => e.status === "VALIDATED").length,
            inProgress: executions.filter(e => ["APPROVED", "IN_PROGRESS", "DELIVERED"].includes(e.status)).length,
            rejected: executions.filter(e => e.status === "REJECTED").length
        };

        return res.json({ executions, stats });
    } catch (err) {
        console.error("Erro ao buscar histórico", err);
        return res.status(500).json({ message: "Erro ao buscar histórico" });
    }
});

// Request Quote (Send Email)
router.post("/:id/quote", authMiddleware, requireRole([Role.MASTER, Role.ADMIN, Role.PRODUCER]), async (req, res) => {
    try {
        const { id } = req.params;
        const { message } = req.body;
        const user = req.user!;

        // 1. Get Provider
        const provider = await prisma.accessibilityProvider.findUnique({ where: { id } });
        if (!provider) return res.status(404).json({ message: "Prestador não encontrado" });

        if (!provider.email) return res.status(400).json({ message: "Prestador sem e-mail cadastrado." });

        // 2. Get Producer Info
        const producer = await prisma.user.findUnique({ where: { id: user.id } });
        const producerName = producer?.name || "Produtor Cultural";

        // 3. Send Email
        const sent = await mailService.sendQuoteRequest(
            provider.email,
            producerName,
            user.email,
            provider.name,
            message
        );

        if (sent) {
            return res.json({ message: "Solicitação enviada com sucesso!" });
        } else {
            return res.status(500).json({ message: "Erro ao enviar e-mail." });
        }

    } catch (err) {
        console.error("Error sending quote", err);
        return res.status(500).json({ message: "Erro ao solicitar orçamento" });
    }
});

export default router;
