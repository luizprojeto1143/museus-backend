import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { checkEntityOwnership, assertTenantOwnership } from '../../utils/ownership.js';

const router = Router();

// ==========================================
// ADMIN ROUTES (CRUD Coupons)
// ==========================================

// GET /coupons - List all coupons for the tenant
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = req.user!.tenantId as string;
        const coupons = await prisma.coupon.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' }
        });
        res.json(coupons);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao buscar cupons' });
    }
});

// POST /coupons - Create a new coupon
router.post('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = req.user!.tenantId as string;
        const { code, discountType, discountValue, xpCost, description, isActive } = req.body;

        // Ensure code is unique within tenant (or globally)
        const existing = await prisma.coupon.findUnique({ where: { code } });
        if (existing) {
            return res.status(400).json({ error: 'Já existe um cupom com este código.' });
        }

        const coupon = await prisma.coupon.create({
            data: {
                code: code.toUpperCase(),
                tenantId,
                discountType,
                discountValue,
                xpCost: xpCost ? Number(xpCost) : null,
                description,
                isActive: isActive ?? true
            }
        });

        res.status(201).json(coupon);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao criar cupom' });
    }
});

// PUT /coupons/:id/toggle - Toggle Activeness
router.put('/:id/toggle', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        const coupon = await assertTenantOwnership({ model: 'coupon', id, user: req.user! });
        const updated = await prisma.coupon.update({
            where: { id },
            data: { isActive: !coupon.isActive }
        });

        res.json(updated);
    } catch (err: any) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error(err);
        res.status(500).json({ error: 'Erro ao atualizar cupom' });
    }
});

// DELETE /coupons/:id
router.delete('/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        await assertTenantOwnership({ model: 'coupon', id, user: req.user! });

        await prisma.coupon.delete({ where: { id } });
        res.status(204).send();
    } catch (err: any) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error(err);
        res.status(500).json({ error: 'Erro ao deletar cupom' });
    }
});


// ==========================================
// VISITOR ROUTES (Redeem & Get Available)
// ==========================================

// GET /coupons/available - Get coupons available for exchange using XP
router.get('/available', authMiddleware, requireRole(['VISITOR']), async (req, res) => {
    try {
        const tenantId = req.user!.tenantId as string;
        const visitor = await prisma.visitor.findFirst({
            where: {
                email: req.user!.email.toLowerCase(),
                tenantId
            }
        });

        if (!visitor) {
            return res.json({ available: [], redeemed: [] });
        }

        // Get coupons that cost XP and are active
        const availableCoupons = await prisma.coupon.findMany({
            where: {
                tenantId,
                isActive: true,
                xpCost: { not: null }
            }
        });

        // Which ones did the visitor already redeem?
        const redeemed = await prisma.visitorCoupon.findMany({
            where: { visitorId: visitor.id },
            include: { coupon: true }
        });

        const redeemedIds = redeemed.map(r => r.couponId);

        // Mark available vs redeemed
        const result = availableCoupons.map(c => ({
            ...c,
            alreadyRedeemed: redeemedIds.includes(c.id)
        }));

        res.json({
            available: result,
            redeemed: redeemed.map(r => ({
                id: r.id,
                redeemedAt: r.redeemedAt,
                usedAt: r.usedAt,
                coupon: r.coupon
            }))
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao buscar cupons' });
    }
});

// POST /coupons/:id/redeem - Trade XP for a Coupon
router.post('/:id/redeem', authMiddleware, requireRole(['VISITOR']), async (req, res) => {
    try {
        const { id } = req.params; // Coupon ID
        const tenantId = req.user!.tenantId as string;

        const [visitor, coupon] = await Promise.all([
            prisma.visitor.findFirst({
                where: {
                    email: req.user!.email.toLowerCase(),
                    tenantId
                }
            }),
            prisma.coupon.findUnique({ where: { id } })
        ]);

        if (!visitor || !coupon) {
            return res.status(404).json({ error: 'Visitante ou Cupom não encontrado' });
        }

        if (coupon.tenantId !== tenantId) {
            return res.status(403).json({ error: 'Cupom não pertence a este museu' });
        }

        if (!coupon.isActive) {
            return res.status(400).json({ error: 'Este cupom não está mais ativo' });
        }

        if (!coupon.xpCost) {
            return res.status(400).json({ error: 'Este cupom não é trocável por XP' });
        }

        const xpCost = coupon.xpCost;

        // Check if already redeemed
        const existingRedemption = await prisma.visitorCoupon.findUnique({
            where: { visitorId_couponId: { visitorId: visitor.id, couponId: id } }
        });

        if (existingRedemption) {
            return res.status(400).json({ error: 'Você já resgatou este cupom!' });
        }

        // Check Balance
        if (visitor.xp < xpCost) {
            return res.status(400).json({ error: `XP Insuficiente. Requer ${xpCost} XP.` });
        }

        // Perform Trade (Transaction)
        await prisma.$transaction(async (tx) => {
            const updated = await tx.visitor.updateMany({
                where: {
                    id: visitor.id,
                    xp: { gte: xpCost }
                },
                data: { xp: { decrement: xpCost } }
            });

            if (updated.count !== 1) {
                throw new Error("INSUFFICIENT_XP");
            }

            await tx.visitorCoupon.create({
                data: {
                    visitorId: visitor.id,
                    couponId: id
                }
            });
        });

        res.json({ message: 'Cupom resgatado com sucesso!', code: coupon.code });

    } catch (err: any) {
        if (err?.message === "INSUFFICIENT_XP") {
            return res.status(400).json({ error: 'XP Insuficiente.' });
        }
        if (err?.code === 'P2002') {
            return res.status(400).json({ error: 'Você já resgatou este cupom!' });
        }
        console.error(err);
        res.status(500).json({ error: 'Erro ao resgatar cupom' });
    }
});

export const couponsRouter = router;
