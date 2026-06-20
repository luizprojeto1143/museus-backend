import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { z } from "zod";

const router = Router();

// List Conversations
router.get("/", authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const where: any = {};

        if (user.role === Role.PRODUCER) {
            where.producerId = user.id;
        } else if (user.role === Role.MASTER || user.role === Role.ADMIN) {
            // Master can see all
        } else {
            const provider = await prisma.accessibilityProvider.findUnique({ where: { userId: user.id } });
            if (provider) {
                where.providerId = provider.id;
            } else {
                return res.json([]);
            }
        }

        const conversations = await prisma.conversation.findMany({
            where,
            include: {
                accessibilityProvider: { select: { id: true, name: true, email: true } },
                user: { select: { id: true, name: true, email: true } },
                messages: {
                    orderBy: { createdAt: "desc" },
                    take: 1
                }
            },
            orderBy: { lastMessageAt: "desc" }
        });

        return res.json(conversations);
    } catch (err) {
        console.error("Error listing conversations", err);
        return res.status(500).json({ message: "Error listing conversations" });
    }
});

// Get Conversation Details
router.get("/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const conversation = await prisma.conversation.findUnique({
            where: { id },
            include: {
                accessibilityProvider: { select: { id: true, name: true, email: true } },
                user: { select: { id: true, name: true, email: true } },
                messages: { orderBy: { createdAt: "asc" } },
                transactions: { orderBy: { createdAt: "desc" } }
            }
        });

        if (!conversation) return res.status(404).json({ message: "Conversation not found" });

        const isProducer = conversation.producerId === user.id;
        const providerProfile = await prisma.accessibilityProvider.findUnique({ where: { userId: user.id } });
        const isProvider = (conversation as any).accessibilityProvider.id === providerProfile?.id;
        const isAdmin = user.role === Role.ADMIN || user.role === Role.MASTER;

        if (!isProducer && !isProvider && !isAdmin) {
            return res.status(403).json({ message: "Access denied" });
        }

        return res.json(conversation);
    } catch (err) {
        console.error("Error getting conversation", err);
        return res.status(500).json({ message: "Error getting conversation" });
    }
});

// Create Conversation
router.post("/", authMiddleware, async (req, res) => {
    try {
        const { providerId, initialMessage } = req.body;
        const user = req.user!;

        let conversation = await prisma.conversation.findUnique({
            where: {
                producerId_providerId: {
                    producerId: user.id,
                    providerId
                }
            }
        });

        if (!conversation) {
            conversation = await prisma.conversation.create({
                data: {
                    producerId: user.id,
                    providerId,
                    status: "OPEN"
                }
            });
        }

        if (initialMessage) {
            await prisma.message.create({
                data: {
                    conversationId: conversation.id,
                    senderId: user.id,
                    senderType: "PRODUCER",
                    content: initialMessage,
                    type: "TEXT"
                }
            });
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: { lastMessageAt: new Date() }
            });
        }

        return res.json(conversation);
    } catch (err) {
        return res.status(500).json({ message: "Error creating conversation" });
    }
});

// Send Message
router.post("/:id/messages", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { content, type, attachments } = req.body;
        const user = req.user!;

        const conversation = await prisma.conversation.findUnique({ where: { id } });
        if (!conversation) return res.status(404).json({ message: "Conversation not found" });

        let senderType = "SYSTEM";
        if (conversation.producerId === user.id) {
            senderType = "PRODUCER";
        } else {
            const provider = await prisma.accessibilityProvider.findUnique({ where: { userId: user.id } });
            if (provider && provider.id === conversation.providerId) {
                senderType = "PROVIDER";
            } else if (user.role === Role.MASTER || user.role === Role.ADMIN) {
                senderType = "SYSTEM";
            } else {
                return res.status(403).json({ message: "Access denied" });
            }
        }

        const message = await prisma.message.create({
            data: {
                conversationId: id,
                senderId: user.id,
                senderType,
                content,
                type: type || "TEXT",
                attachments
            }
        });

        await prisma.conversation.update({
            where: { id },
            data: { lastMessageAt: new Date() }
        });

        return res.json(message);
    } catch (err) {
        return res.status(500).json({ message: "Error sending message" });
    }
});

// Initialize Payment (Stripe Marketplace Connect)
router.post("/:id/payment", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, description } = req.body;
        const user = req.user!;

        const conversation = await prisma.conversation.findUnique({ 
            where: { id },
            include: { accessibilityProvider: true }
        });
        if (!conversation) return res.status(404).json({ message: "Conversation not found" });

        // 1. Stripe Split Payment Logic
        const { stripeService } = await import("../services/stripeService.js");
        const amountCents = Math.round(amount * 100);
        const feePercentage = (conversation as any).accessibilityProvider?.feePercentage ?? 10.0;
        const platformFeeCents = Math.round(amountCents * (feePercentage / 100)); // Taxa configurável

        const stripeCustomerId = await stripeService.createCustomer({
            name: user.name || "User",
            email: user.email,
            userId: user.id
        });

        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

        const session = await stripeService.createSplitPaymentSession({
            customerId: stripeCustomerId,
            amount: amountCents,
            description: `Serviço Profissional: ${description}`,
            connectedAccountId: (conversation as any).accessibilityProvider?.stripeConnectId || '', // Payout to Provider
            applicationFeeAmount: platformFeeCents,
            successUrl: `${frontendUrl}/inbox/${id}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${frontendUrl}/inbox/${id}/cancel`
        });

        // 2. Create Transaction
        const transaction = await prisma.transaction.create({
            data: {
                conversationId: id,
                payerId: user.id,
                payeeId: conversation.providerId,
                amount,
                description,
                status: "PENDING",
                stripePaymentIntentId: session.id
            }
        });

        // 3. Send Message automatically
        await prisma.message.create({
            data: {
                conversationId: id,
                senderId: user.id,
                senderType: "SYSTEM",
                content: `Solicitação de Pagamento gerada: R$ ${amount}. [Clique aqui para pagar](${session.url})`,
                type: "PAYMENT_REQUEST"
            }
        });

        return res.json({
            transaction,
            checkoutUrl: session.url
        });

    } catch (err) {
        console.error("Error creating payment", err);
        return res.status(500).json({ message: "Error creating payment" });
    }
});

export default router;
