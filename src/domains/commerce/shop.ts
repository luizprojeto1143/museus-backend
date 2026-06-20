import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { mailService } from '../../services/email.js';
import { z } from 'zod';
import { Role } from '@prisma/client';

const router = Router();

const productSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  description: z.string().optional(),
  price: z.any().transform(v => {
    if (v === null || v === "" || v === undefined) return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }).refine(v => v >= 0, "Preço não pode ser negativo"),
  imageUrl: z.string().optional(),
  category: z.string().optional(),
  sku: z.string().optional(),
  stock: z.any().transform(v => {
    if (v === null || v === "" || v === undefined) return 0;
    const n = Math.floor(Number(v));
    return isNaN(n) ? 0 : n;
  }).refine(v => v >= 0, "Estoque não pode ser negativo"),
  active: z.boolean().default(true)
});

// ============ PRODUCTS ============

router.get('/products', async (req, res) => {
    try {
        const { tenantId, category, active } = req.query;
        if (!tenantId) return res.status(400).json({ message: 'tenantId é obrigatório' });
        const where: any = { tenantId: tenantId as string };
        if (category) where.category = category;
        if (active !== 'all') where.active = active !== 'false';
        const products = await prisma.product.findMany({ where, orderBy: { createdAt: 'desc' } });
        res.json(products);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar produtos' });
    }
});

router.get('/products/:id', async (req, res) => {
    try {
        const product = await prisma.product.findUnique({ where: { id: req.params.id } });
        if (!product) return res.status(404).json({ message: 'Produto não encontrado' });
        res.json(product);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar produto' });
    }
});

router.post('/products', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
  try {
    const { tenantId } = req.body;
    const result = productSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: 'Erro de validação', errors: result.error.errors });
    const product = await prisma.product.create({ data: { ...result.data, tenantId } as any });
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar produto' });
  }
});

// ============ ORDERS ============

router.post('/orders', authMiddleware, async (req, res) => {
    try {
        const {
            tenantId,
            customerName,
            customerEmail,
            customerPhone,
            shippingAddress,
            items,
            couponCode
        } = req.body;

        if (!tenantId || !customerName || !customerEmail || !items?.length) {
            return res.status(400).json({ message: 'Dados incompletos' });
        }

        // 1. Stripe Integration
        let stripePaymentData: any = null;

        const result = await prisma.$transaction(async (tx) => {
            // Fetch all products to validate stock and calculate total
            const productIds = items.map((i: { productId: string }) => i.productId);
            const products = await tx.product.findMany({ where: { id: { in: productIds } } });

            let total = 0;
            const orderItems: { productId: string; quantity: number; unitPrice: number }[] = [];

            for (const item of items as Array<{ productId: string; quantity: number }>) {
                const product = products.find(p => p.id === item.productId);
                if (!product) throw new Error(`Produto ${item.productId} não encontrado`);
                if (product.stock < item.quantity) throw new Error(`Estoque insuficiente: ${product.name}`);
                
                const price = Number(product.price);
                total += price * item.quantity;
                orderItems.push({
                    productId: item.productId,
                    quantity: item.quantity,
                    unitPrice: price
                });
            }

            // Coupon Logic
            if (couponCode) {
                const coupon = await tx.coupon.findUnique({ where: { code: couponCode } });
                if (coupon && coupon.tenantId === tenantId && coupon.isActive) {
                    if (coupon.discountType === 'PERCENTAGE') {
                        total -= total * (Number(coupon.discountValue) / 100);
                    } else {
                        total -= Number(coupon.discountValue);
                    }
                }
            }

            total = Math.max(0, total);

            // Fetch Tenant for Split
            const tenant = await tx.tenant.findUnique({
                where: { id: tenantId },
                select: { stripeConnectId: true, name: true, feePercentage: true }
            });

            const { stripeService } = await import('../../services/stripeService.js');
            const amountCents = Math.round(total * 100);
            const feePercent = tenant?.feePercentage ?? 5.0;
            const platformFeeCents = Math.round(amountCents * (feePercent / 100));

            const stripeCustomerId = await stripeService.createCustomer({
                name: customerName,
                email: customerEmail,
                userId: req.user?.id || 'guest'
            });

            const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

            const session = await stripeService.createSplitPaymentSession({
                customerId: stripeCustomerId,
                amount: amountCents,
                description: `Pedido na Loja: ${tenant?.name || 'Cultura'}`,
                connectedAccountId: tenant?.stripeConnectId || '',
                applicationFeeAmount: platformFeeCents,
                successUrl: `${frontendUrl}/shop/success?orderId={CHECKOUT_SESSION_ID}`,
                cancelUrl: `${frontendUrl}/shop/cancel`
            });

            stripePaymentData = { id: session.id, checkoutUrl: session.url };

            const order = await tx.order.create({
                data: {
                    tenantId,
                    customerName,
                    customerEmail,
                    customerPhone,
                    shippingAddress,
                    total,
                    platformFee: total * 0.05,
                    stripePaymentIntentId: session.id,
                    orderItems: { create: orderItems }
                }
            });

            // Restock decrement
            for (const item of items) {
                await tx.product.update({
                    where: { id: item.productId },
                    data: { stock: { decrement: item.quantity } }
                });
            }

            return order;
        });

        res.status(201).json({
            order: result,
            payment: stripePaymentData
        });

    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Erro ao criar pedido' });
    }
});

router.get('/orders', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { tenantId, status } = req.query;
        const where: any = {};
        if (tenantId) where.tenantId = tenantId;
        if (status) where.status = status;
        const orders = await prisma.order.findMany({ where, include: { orderItems: { include: { product: true } } }, orderBy: { createdAt: 'desc' } });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar pedidos' });
    }
});

router.get('/my-orders', authMiddleware, async (req, res) => {
    try {
        const orders = await prisma.order.findMany({
            where: { customerEmail: req.user?.email },
            include: { orderItems: { include: { product: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar seus pedidos' });
    }
});

export default router;
