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

        // If producer, find where producerId matches
        if (user.role === Role.PRODUCER) {
            where.producerId = user.id;
        }
        // If master/admin, can see all (for audit)
        else if (user.role === Role.MASTER || user.role === Role.ADMIN) {
            // Optional: Filter by tenant? For now, see all.
        }
        // If user is linked to a provider (need to check relation)
        else {
            // Check if user is a provider
            const provider = await prisma.accessibilityProvider.findUnique({ where: { userId: user.id } });
            if (provider) {
                where.providerId = provider.id;
            } else {
                return res.json([]); // No conversations
            }
        }

        const conversations = await prisma.conversation.findMany({
            where,
            include: {
                provider: { select: { id: true, name: true, email: true } },
                producer: { select: { id: true, name: true, email: true } },
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
                provider: { select: { id: true, name: true, email: true } },
                producer: { select: { id: true, name: true, email: true } },
                messages: {
                    orderBy: { createdAt: "asc" }
                },
                transactions: {
                    orderBy: { createdAt: "desc" }
                }
            }
        });

        if (!conversation) return res.status(404).json({ message: "Conversation not found" });

        // Access Control
        const isProducer = conversation.producerId === user.id;
        const isProvider = conversation.provider.id === (await prisma.accessibilityProvider.findUnique({ where: { userId: user.id } }))?.id;
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

// Create Conversation (Start Negotiation)
router.post("/", authMiddleware, async (req, res) => {
    try {
        const { providerId, initialMessage } = req.body;
        const user = req.user!; // Producer

        // Check if conversation exists
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

        // Add Initial Message
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

            // Update lastMessageAt
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: { lastMessageAt: new Date() }
            });
        }

        return res.json(conversation);
    } catch (err) {
        console.error("Error creating conversation", err);
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

        // Identify sender type
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
                senderType, // "PRODUCER" | "PROVIDER" | "SYSTEM"
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
        console.error("Error sending message", err);
        return res.status(500).json({ message: "Error sending message" });
    }
});

// Initialize Payment (Asaas Integration Stub)
router.post("/:id/payment", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, description, paymentMethod } = req.body; // paymentMethod: PIX, CREDIT_CARD
        const user = req.user!;

        const conversation = await prisma.conversation.findUnique({ where: { id } });
        if (!conversation) return res.status(404).json({ message: "Conversation not found" });

        // 1. Call Asaas API (Simulated for now)
        // const asaasResponse = await asaas.createPayment(...)
        const fakeAsaasId = `pay_${Date.now()}`;
        const fakeInvoiceUrl = `https://sandbox.asaas.com/i/${fakeAsaasId}`;
        const fakePixQrCode = "00020126580014BR.GOV.BCB.PIX0136...";
        const fakePixCopyPaste = "00020126580014BR.GOV.BCB.PIX0136...";

        // 2. Create Transaction
        const transaction = await prisma.transaction.create({
            data: {
                conversationId: id,
                payerId: user.id,
                payeeId: conversation.providerId,
                amount,
                description,
                status: "PENDING",
                asaasId: fakeAsaasId,
                paymentMethod,
                asaasInvoiceUrl: fakeInvoiceUrl,
                pixQrCode: paymentMethod === "PIX" ? fakePixQrCode : null,
                pixCopyPaste: paymentMethod === "PIX" ? fakePixCopyPaste : null
            }
        });

        // 3. Send Message automatically
        await prisma.message.create({
            data: {
                conversationId: id,
                senderId: user.id,
                senderType: "SYSTEM",
                content: `Solicitação de Pagamento gerada: R$ ${amount}`,
                type: "PAYMENT_REQUEST"
            }
        });

        return res.json(transaction);

    } catch (err) {
        console.error("Error creating payment", err);
        return res.status(500).json({ message: "Error creating payment" });
    }
});

export default router;
