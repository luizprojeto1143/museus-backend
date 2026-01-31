import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
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
            items // Array of { productId, quantity }
        } = req.body;

        if (!tenantId || !customerName || !customerEmail || !items?.length) {
            return res.status(400).json({ message: 'Dados incompletos' });
        }

        // SECURITY FIX: Use transaction to prevent race condition
        const result = await prisma.$transaction(async (tx) => {
            // Fetch all products at once (N+1 fix)
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

            // Create order with items
            const order = await tx.order.create({
                data: {
                    tenantId,
                    customerName,
                    customerEmail,
                    customerPhone,
                    shippingAddress,
                    total,
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
            message: 'Pedido criado. Aguardando pagamento.'
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
