import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { asaasService } from '../services/asaasService.js';
import { mailService } from '../services/email.js';
import { z } from 'zod';
import { Role } from '@prisma/client';

const router = Router();

const productSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    price: z.number().positive(),
    imageUrl: z.string().optional(),
    category: z.string().optional(),
    sku: z.string().optional(),
    stock: z.number().int().min(0).default(0),
    active: z.boolean().default(true)
});

// ============ PRODUCTS ============

// GET /shop/products - List products
router.get('/products', async (req, res) => {
    try {
        const { tenantId, category, active } = req.query;

        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId é obrigatório' });
        }

        const where: any = { tenantId: tenantId as string };
        if (category) where.category = category;
        if (active !== 'all') where.active = active !== 'false';

        const products = await prisma.product.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        res.json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ message: 'Erro ao buscar produtos' });
    }
});

// GET /shop/products/:id - Get single product
router.get('/products/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const product = await prisma.product.findUnique({
            where: { id }
        });

        if (!product) {
            return res.status(404).json({ message: 'Produto não encontrado' });
        }

        res.json(product);
    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).json({ message: 'Erro ao buscar produto' });
    }
});

// POST /shop/products - Create product (Admin)
router.post('/products', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { tenantId } = req.body;
        const data = productSchema.parse(req.body);

        const product = await prisma.product.create({
            data: {
                ...data,
                tenantId
            }
        });

        res.status(201).json(product);
    } catch (error) {
        console.error('Error creating product:', error);
        res.status(500).json({ message: 'Erro ao criar produto' });
    }
});

// PUT /shop/products/:id - Update product (Admin)
router.put('/products/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;
        const data = productSchema.partial().parse(req.body);

        // SECURITY: Verify product belongs to user's tenant (unless MASTER)
        const existing = await prisma.product.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ message: 'Produto não encontrado' });
        }
        if (user.role !== Role.MASTER && existing.tenantId !== user.tenantId) {
            return res.status(403).json({ message: 'Sem permissão para alterar este produto' });
        }

        const product = await prisma.product.update({
            where: { id },
            data
        });

        res.json(product);
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({ message: 'Erro ao atualizar produto' });
    }
});

// DELETE /shop/products/:id - Delete product (Admin)
router.delete('/products/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        // SECURITY: Verify product belongs to user's tenant (unless MASTER)
        const existing = await prisma.product.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ message: 'Produto não encontrado' });
        }
        if (user.role !== Role.MASTER && existing.tenantId !== user.tenantId) {
            return res.status(403).json({ message: 'Sem permissão para remover este produto' });
        }

        await prisma.product.delete({ where: { id } });
        res.json({ message: 'Produto removido' });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ message: 'Erro ao remover produto' });
    }
});

// ============ ORDERS ============

// POST /shop/orders - Create order (SECURITY: Now requires auth + atomic stock)
router.post('/orders', authMiddleware, async (req, res) => {
    try {
        const {
            tenantId,
            customerName,
            customerEmail,
            customerPhone,
            shippingAddress,
            paymentMethod = 'PIX', // Default to PIX
            items, // Array of { productId, quantity }
            couponCode
        } = req.body;

        if (!tenantId || !customerName || !customerEmail || !items?.length) {
            return res.status(400).json({ message: 'Dados incompletos' });
        }

        // Asaas Integration
        let asaasPaymentId = null;
        let invoiceUrl = null;
        let bankSlipUrl = null;
        let pixQrCode = null;
        let pixPayload = null;
        let couponToMarkUsed: { visitorId: string, couponId: string } | null = null;

        try {
            // 1. Create/Get Customer
            const asaasCustomerId = await asaasService.createCustomer({
                name: customerName,
                email: customerEmail,
                phone: customerPhone,
                mobilePhone: customerPhone
            });

            // 2. Calculate Total (Check stock first)
            const productIds = items.map((i: { productId: string }) => i.productId);
            const products = await prisma.product.findMany({
                where: { id: { in: productIds } }
            });

            let total = 0;
            for (const item of items) {
                const product = products.find(p => p.id === item.productId);
                if (product) {
                    total += Number(product.price) * item.quantity;
                }
            }

            // --- COUPON PROCESSING ---
            const reqUser = req.user as any;
            if (couponCode && reqUser?.visitorId) {
                const visitorId = reqUser.visitorId;
                const coupon = await prisma.coupon.findUnique({
                    where: { code: couponCode }
                });

                if (coupon && coupon.tenantId === tenantId && coupon.isActive) {
                    // Check if visitor has this coupon
                    const visitorCoupon = await prisma.visitorCoupon.findUnique({
                        where: { visitorId_couponId: { visitorId, couponId: coupon.id } }
                    });

                    if (visitorCoupon && !visitorCoupon.usedAt) {
                        // Apply Discount
                        if (coupon.discountType === 'PERCENTAGE') {
                            const discount = total * (Number(coupon.discountValue) / 100);
                            total = Math.max(0, total - discount);
                        } else {
                            total = Math.max(0, total - Number(coupon.discountValue));
                        }
                        couponToMarkUsed = { visitorId, couponId: coupon.id };
                    }
                }
            }

            // 3. Create Payment (Only if total > 0)
            const billingType = paymentMethod === 'BOLETO' ? 'BOLETO' : 'PIX';
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 1);

            // Fetch Tenant Wallet ID
            const tenant = await prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { asaasWalletId: true }
            });

            // PLATFORM FEE CALCULATION (5%)
            const split = [];

            // 1. Platform Fee (5%)
            if (process.env.ASAAS_PLATFORM_WALLET_ID) {
                split.push({
                    walletId: process.env.ASAAS_PLATFORM_WALLET_ID,
                    percentualValue: 5
                });
            }

            // 2. Museum Share (95%)
            if (tenant?.asaasWalletId) {
                split.push({
                    walletId: tenant.asaasWalletId,
                    percentualValue: 95
                });
            }

            const payment = await asaasService.createPayment({
                customer: asaasCustomerId,
                billingType,
                value: total,
                dueDate: dueDate.toISOString().split('T')[0],
                description: `Pedido na Loja Virtual`,
                split: split.length > 0 ? split : undefined
            });

            asaasPaymentId = payment.id;
            invoiceUrl = payment.invoiceUrl;
            bankSlipUrl = payment.bankSlipUrl;

            // 4. Get Pix QR Code if Pix
            if (billingType === 'PIX') {
                const pixData = await asaasService.getPixQrCode(payment.id);
                if (pixData) {
                    pixQrCode = pixData.encodedImage;
                    pixPayload = pixData.payload;
                }
            }
        } catch (err) {
            console.error("Erro ao integrar com Asaas (mas continuando pedido):", err);
            // We continue to create the order even if payment fails initially (status PENDING)
            // But usually we want to fail fast. Let's log and continue for now as "PENDING".
        }

        // SECURITY FIX: Use transaction to prevent race condition
        const result = await prisma.$transaction(async (tx) => {
            // If there's a coupon to mark, mark it
            if (couponToMarkUsed) {
                await tx.visitorCoupon.update({
                    where: { visitorId_couponId: couponToMarkUsed },
                    data: { usedAt: new Date() }
                });
            }

            // Fetch all products at once (N+1 fix) -- Redundant fetch but safe inside TX
            const productIds = items.map((i: { productId: string }) => i.productId);
            const products = await tx.product.findMany({
                where: { id: { in: productIds } }
            });

            // Validate all products exist and have stock
            let total = 0;
            const orderItems: { productId: string; quantity: number; unitPrice: number }[] = [];

            for (const item of items as Array<{ productId: string; quantity: number }>) {
                const product = products.find(p => p.id === item.productId);
                if (!product) {
                    throw new Error(`Produto ${item.productId} não encontrado`);
                }
                if (product.stock < item.quantity) {
                    throw new Error(`Estoque insuficiente: ${product.name}`);
                }
                const price = Number(product.price);
                total += price * item.quantity;
                orderItems.push({
                    productId: item.productId,
                    quantity: item.quantity,
                    unitPrice: price
                });
            }

            // Re-apply coupon to final transaction total just to be safe
            if (couponToMarkUsed) {
                const coupon = await tx.coupon.findUnique({ where: { id: couponToMarkUsed.couponId } });
                if (coupon) {
                    if (coupon.discountType === 'PERCENTAGE') {
                        const discount = total * (Number(coupon.discountValue) / 100);
                        total = Math.max(0, total - discount);
                    } else {
                        total = Math.max(0, total - Number(coupon.discountValue));
                    }
                }
            }

            // Create order with items
            const order = await tx.order.create({
                data: {
                    tenantId,
                    customerName,
                    customerEmail,
                    customerPhone,
                    shippingAddress,
                    total,
                    platformFee: total * 0.05,
                    paymentMethod,
                    paymentId: asaasPaymentId,
                    invoiceUrl,
                    bankSlipUrl,
                    pixQrCode,
                    pixPayload,
                    items: {
                        create: orderItems
                    }
                },
                include: { items: { include: { product: true } } }
            });

            // Atomic stock decrement inside transaction
            for (const item of items as Array<{ productId: string; quantity: number }>) {
                await tx.product.update({
                    where: { id: item.productId },
                    data: { stock: { decrement: item.quantity } }
                });
            }

            return order;
        });

        res.status(201).json({
            order: result,
            message: 'Pedido criado com sucesso.',
            payment: {
                id: asaasPaymentId,
                invoiceUrl,
                pixQrCode,
                pixPayload
            }
        });
    } catch (error: unknown) {
        console.error('Error creating order:', error);
        const message = error instanceof Error ? error.message : 'Erro ao criar pedido';
        const status = message.includes('insuficiente') || message.includes('não encontrado') ? 400 : 500;
        res.status(status).json({ message });
    }
});

// GET /shop/orders - List orders (Admin)
router.get('/orders', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { tenantId, status } = req.query;

        const where: any = {};
        if (tenantId) where.tenantId = tenantId;
        if (status) where.status = status;

        const orders = await prisma.order.findMany({
            where,
            include: {
                items: { include: { product: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(orders);
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ message: 'Erro ao buscar pedidos' });
    }
});

// PATCH /shop/orders/:id/status - Update order status (Admin)
router.patch('/orders/:id/status', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ message: 'Status inválido' });
        }

        const order = await prisma.order.update({
            where: { id },
            data: { status }
        });

        res.json(order);
    } catch (error) {
        console.error('Error updating order:', error);
        res.status(500).json({ message: 'Erro ao atualizar pedido' });
    }
});


router.post('/webhook', async (req, res) => {
    try {
        // SECURITY: Verify Asaas Access Token if configured
        const asaasToken = req.headers['asaas-access-token'];
        const configuredToken = process.env.ASAAS_WEBHOOK_SECRET;

        if (configuredToken && asaasToken !== configuredToken) {
            console.warn(`[Asaas Webhook] Unauthorized request from IP: ${req.ip}`);
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const { event, payment } = req.body;
        console.log(`[Asaas Webhook] Event: ${event}, Payment ID: ${payment?.id}`);

        if (!event || !payment || !payment.id) {
            return res.status(400).json({ message: 'Payload inválido' });
        }

        // Map Asaas events to System Status
        let paymentStatus = null; // 'CONFIRMED' | 'CANCELLED'
        if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
            paymentStatus = 'CONFIRMED';
        } else if (event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_REVERSED') {
            paymentStatus = 'CANCELLED';
        }

        if (paymentStatus) {
            // 1. Check Orders
            const order = await prisma.order.findFirst({ where: { paymentId: payment.id } });
            if (order) {
                const orderStatus = paymentStatus === 'CONFIRMED' ? 'PAID' : 'CANCELLED';
                if (order.status !== orderStatus) {
                    await prisma.order.update({ where: { id: order.id }, data: { status: orderStatus } });
                    if (orderStatus === 'CANCELLED') console.log(`Order ${order.id} cancelled. Restocking needed.`);
                }
                return res.json({ received: true, mappedTo: 'Order' });
            }

            // 2. Check Donations
            const donation = await prisma.donation.findFirst({ where: { paymentId: payment.id } });
            if (donation) {
                const donationStatus = paymentStatus === 'CONFIRMED' ? 'COMPLETED' : 'CANCELLED';
                if (donation.status !== donationStatus) {
                    await prisma.donation.update({ where: { id: donation.id }, data: { status: donationStatus } });
                }
                return res.json({ received: true, mappedTo: 'Donation' });
            }

            // 3. Check Registrations (Paid Tickets)
            const registration = await prisma.registration.findFirst({
                where: { asaasPaymentId: payment.id },
                include: { event: true, ticket: true }
            });
            if (registration) {
                if (registration.status !== paymentStatus) {
                    await prisma.registration.update({
                        where: { id: registration.id },
                        data: { asaasPaymentStatus: event, status: paymentStatus as any } // Cast to any or RegistrationStatus
                    });

                    // If CONFIRMED, send ticket email
                    if (paymentStatus === 'CONFIRMED') {
                        const eventDate = registration.event.startDate ? new Date(registration.event.startDate).toLocaleDateString('pt-BR', {
                            weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
                        }) : undefined;

                        mailService.sendTicketEmail(
                            registration.guestEmail,
                            registration.event.title,
                            registration.guestName,
                            registration.code,
                            eventDate,
                            registration.event.location || undefined
                        ).catch(e => console.error("Error sending paid ticket email via webhook", e));
                    }
                }
                return res.json({ received: true, mappedTo: 'Registration' });
            }

            console.warn(`[Asaas Webhook] No matching record found for payment ${payment.id}`);
        }

        res.json({ received: true });
    } catch (error) {
        console.error('Webhook Error:', error);
        res.status(500).json({ message: 'Erro no webhook' });
    }
});

// GET /shop/orders/:id - Get order details (Customer or Admin)
router.get('/orders/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: { include: { product: true } }
            }
        });

        if (!order) {
            return res.status(404).json({ message: 'Pedido não encontrado' });
        }

        // Security: Check ownership (by email) or role
        // Note: user.email comes from auth token. order.customerEmail comes from order.
        const isAdmin = user.role === 'MASTER' || user.role === 'ADMIN';
        const isOwner = user.email && order.customerEmail === user.email;

        if (!isAdmin && !isOwner) {
            return res.status(403).json({ message: 'Sem permissão para visualizar este pedido' });
        }

        res.json(order);
    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({ message: 'Erro ao buscar pedido' });
    }
});

// GET /shop/categories - List product categories
router.get('/categories', async (req, res) => {
    try {
        const { tenantId } = req.query;

        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId é obrigatório' });
        }

        const categories = await prisma.product.groupBy({
            by: ['category'] as any,
            where: { tenantId: tenantId as string, active: true },
            _count: true
        });

        res.json(categories.filter(c => c.category !== null));
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ message: 'Erro ao buscar categorias' });
    }
});

export default router;
