import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { mailService } from '../../services/email.js';
import { z } from 'zod';
import { Role, PlatformFeeSource } from '@prisma/client';
import { getPlatformFee } from '../../services/fee.service.js';

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
        const product = await prisma.product.findFirst({ where: { id: req.params.id, active: true } });
        if (!product) return res.status(404).json({ message: 'Produto não encontrado' });
        res.json(product);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar produto' });
    }
});

router.post('/products', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
  try {
    const tenantId = req.user!.role === Role.MASTER ? req.body.tenantId : req.user!.tenantId;
    if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatorio' });
    const result = productSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: 'Erro de validação', errors: result.error.errors });
    const product = await prisma.product.create({ data: { ...result.data, tenantId } as any });
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar produto' });
  }
});

router.put('/products/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
  try {
    const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Produto nao encontrado' });
    if (req.user!.role !== Role.MASTER && existing.tenantId !== req.user!.tenantId) {
      return res.status(403).json({ message: 'Sem permissao para editar este produto' });
    }

    const result = productSchema.partial().safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: 'Erro de validacao', errors: result.error.errors });

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: result.data as any
    });
    res.json(product);
  } catch (error: any) {
    if (error?.code === 'P2002') return res.status(409).json({ message: 'SKU ja cadastrado para este tenant' });
    res.status(500).json({ message: 'Erro ao atualizar produto' });
  }
});

router.delete('/products/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
  try {
    const existing = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { orderItems: true } } }
    });
    if (!existing) return res.status(404).json({ message: 'Produto nao encontrado' });
    if (req.user!.role !== Role.MASTER && existing.tenantId !== req.user!.tenantId) {
      return res.status(403).json({ message: 'Sem permissao para excluir este produto' });
    }

    if (existing._count.orderItems > 0) {
      const product = await prisma.product.update({
        where: { id: req.params.id },
        data: { active: false }
      });
      return res.json({ ...product, archived: true });
    }

    await prisma.product.delete({ where: { id: req.params.id } });
    return res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao excluir produto' });
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
            const products = await tx.product.findMany({
                where: { id: { in: productIds }, tenantId, active: true }
            });

            let total = 0;
            const orderItems: { productId: string; quantity: number; unitPrice: number }[] = [];

            for (const item of items as Array<{ productId: string; quantity: number }>) {
                const product = products.find(p => p.id === item.productId);
                if (!product) throw new Error(`Produto ${item.productId} não encontrado`);
                if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1) {
                    throw new Error(`Quantidade invalida para ${product.name}`);
                }
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
                select: { stripeConnectId: true, name: true }
            });
            if (!tenant?.stripeConnectId) {
                throw new Error('Loja sem conta Stripe Connect configurada');
            }

            const { stripeService } = await import('../../services/stripeService.js');
            const amountCents = Math.round(total * 100);

            // Sprint 15: Calcular taxa via Central de Taxas
            const feeResult = await getPlatformFee({
                tenantId,
                sourceType: PlatformFeeSource.SHOP,
                amountCents
            });
            const platformFeeCents = feeResult.platformFeeCents;

            const stripeCustomerId = await stripeService.createCustomer({
                name: customerName,
                email: customerEmail,
                userId: req.user?.id || 'guest'
            });

            const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

            const session = await stripeService.createSplitPaymentSession({
                customerId: stripeCustomerId,
                amount: feeResult.buyerPaysCents, // BUYER paga base + taxa
                description: `Pedido na Loja: ${tenant?.name || 'Cultura'}`,
                connectedAccountId: tenant.stripeConnectId,
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
                    platformFee: platformFeeCents / 100,
                    stripeCheckoutSessionId: session.id,
                    orderItems: { create: orderItems },
                    // Sprint 15 — fee snapshot
                    feeConfigId: feeResult.configId,
                    platformFeePercent: feeResult.percentage,
                    platformFeeAmountCents: platformFeeCents,
                    feePaidBy: feeResult.feePaidBy
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
        const targetTenantId = req.user!.role === Role.MASTER ? (tenantId as string | undefined) : req.user!.tenantId;
        if (targetTenantId) where.tenantId = targetTenantId;
        if (status) where.status = status;
        const orders = await prisma.order.findMany({ where, include: { orderItems: { include: { product: true } } }, orderBy: { createdAt: 'desc' } });
        res.json(orders.map(order => ({
            ...order,
            items: order.orderItems
        })));
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar pedidos' });
    }
});

router.patch('/orders/:id/status', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { status } = req.body as { status?: string };
        const allowedStatuses = ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
        if (!status || !allowedStatuses.includes(status)) {
            return res.status(400).json({ message: 'Status invalido' });
        }

        const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
        if (!existing) return res.status(404).json({ message: 'Pedido nao encontrado' });
        if (req.user!.role !== Role.MASTER && existing.tenantId !== req.user!.tenantId) {
            return res.status(403).json({ message: 'Sem permissao para editar este pedido' });
        }

        const order = await prisma.order.update({
            where: { id: req.params.id },
            data: { status }
        });
        return res.json(order);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar status do pedido' });
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
