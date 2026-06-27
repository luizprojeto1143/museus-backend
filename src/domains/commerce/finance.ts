/**
 * @deprecated
 * Este módulo (/finance) é legado e está depreciado em favor de /financial (o módulo canônico de ERP/Razão).
 */
import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { Role } from '@prisma/client';
import { assertTenantOwnership } from '../../utils/ownership.js';
import { PayoutService } from '../../services/payoutService.js';

const router = Router();

// GET /finance/dashboard - Get financial aggregated data
router.get('/dashboard', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'TenantID obrigatório' });
        }

        // Fetch aggregated stats from FinancialTransaction instead of individual tables
        const [
            shopAgg,
            donationsAgg,
            ticketsAgg,
            serviceAgg,
            totalAgg
        ] = await Promise.all([
            prisma.financialTransaction.aggregate({
                where: { tenantId, status: 'COMPLETED', source: 'ORDER' },
                _sum: { amount: true, fee: true, netAmount: true },
                _count: { id: true }
            }),
            prisma.financialTransaction.aggregate({
                where: { tenantId, status: 'COMPLETED', source: 'DONATION' },
                _sum: { amount: true, fee: true, netAmount: true },
                _count: { id: true }
            }),
            prisma.financialTransaction.aggregate({
                where: { tenantId, status: 'COMPLETED', source: 'REGISTRATION' },
                _sum: { amount: true, fee: true, netAmount: true },
                _count: { id: true }
            }),
            prisma.financialTransaction.aggregate({
                where: { tenantId, status: 'COMPLETED', source: 'SERVICE' },
                _sum: { amount: true, fee: true, netAmount: true },
                _count: { id: true }
            }),
            prisma.financialTransaction.aggregate({
                where: { tenantId, status: 'COMPLETED' },
                _sum: { amount: true, fee: true, netAmount: true },
                _count: { id: true }
            })
        ]);

        const totalShop = Number(shopAgg._sum.amount || 0);
        const totalDonations = Number(donationsAgg._sum.amount || 0);
        const totalTickets = Number(ticketsAgg._sum.amount || 0);
        const totalService = Number(serviceAgg._sum.amount || 0);

        const grossTotal = Number(totalAgg._sum.amount || 0);
        const platformFee = Number(totalAgg._sum.fee || 0);
        const netTotal = Number(totalAgg._sum.netAmount || 0);

        // Format for charts (Source Distribution)
        const distribution = [
            { name: 'Loja', value: totalShop },
            { name: 'Doações', value: totalDonations },
            { name: 'Ingressos', value: totalTickets },
            { name: 'Serviços', value: totalService }
        ].filter(item => item.value > 0);

        // Calculate Daily Breakdown dynamically via database
        const last7Days = Array.from({ length: 7 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - i);
            return d.toISOString().split('T')[0];
        }).reverse();

        // Query daily revenue grouped by date
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const dailyTx = await prisma.financialTransaction.findMany({
            where: { tenantId, status: 'COMPLETED', createdAt: { gte: sevenDaysAgo } },
            select: { amount: true, source: true, createdAt: true }
        });

        const dailyRevenue = last7Days.map(dateStr => {
            const dayTxs = dailyTx.filter(t => t.createdAt.toISOString().startsWith(dateStr));
            return {
                date: dateStr,
                loja: dayTxs.filter(t => t.source === 'ORDER').reduce((sum, t) => sum + Number(t.amount), 0),
                doacoes: dayTxs.filter(t => t.source === 'DONATION').reduce((sum, t) => sum + Number(t.amount), 0),
                ingressos: dayTxs.filter(t => t.source === 'REGISTRATION').reduce((sum, t) => sum + Number(t.amount), 0),
                servicos: dayTxs.filter(t => t.source === 'SERVICE').reduce((sum, t) => sum + Number(t.amount), 0)
            };
        });

        res.json({
            summary: {
                grossTotal,
                platformFee,
                netTotal,
                totalTransactions: totalAgg._count.id
            },
            distribution,
            dailyRevenue
        });

    } catch (error) {
        console.error("Finance Dashboard Error:", error);
        res.status(500).json({ message: 'Erro ao carregar dados financeiros' });
    }
});

// GET /finance/dre - Get Dynamic DRE for Municipal Audit & Reporting
router.get('/dre', authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.SECRETARIA]), async (req, res) => {
    try {
        const user = req.user!;
        let tenantId = user.role === Role.MASTER && req.query.tenantId ? (req.query.tenantId as string) : user.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'TenantID obrigatório' });
        }

        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) return res.status(404).json({ message: 'Tenant não encontrado' });

        const isSecretaria = tenant.type === 'CITY' || tenant.type === 'SECRETARIA';
        let tenantIds = [tenantId];
        if (isSecretaria) {
            const children = await prisma.tenant.findMany({
                where: { parentId: tenantId },
                select: { id: true }
            });
            tenantIds = [tenantId, ...children.map(c => c.id)];
        }

        const { startDate, endDate, eventId, equipamentoId, costCenterId } = req.query;

        const where: any = {
            tenantId: { in: tenantIds },
            status: 'COMPLETED'
        };

        if (startDate || endDate) {
            where.competenceDate = {};
            if (startDate) where.competenceDate.gte = new Date(startDate as string);
            if (endDate) where.competenceDate.lte = new Date(endDate as string);
        }

        if (eventId) {
            const regs = await prisma.registration.findMany({
                where: { eventId: eventId as string },
                select: { id: true }
            });
            const regIds = regs.map(r => r.id);
            const refs = await prisma.refund.findMany({
                where: { registrationId: { in: regIds } },
                select: { id: true }
            });
            const refIds = refs.map(r => r.id);
            where.OR = [
                { sourceType: 'REGISTRATION', sourceId: { in: regIds } },
                { sourceType: 'REFUND', sourceId: { in: refIds } }
            ];
        } else if (equipamentoId) {
            const events = await prisma.event.findMany({
                where: { equipamentoId: equipamentoId as string },
                select: { id: true }
            });
            const eventIds = events.map(e => e.id);
            const regs = await prisma.registration.findMany({
                where: { eventId: { in: eventIds } },
                select: { id: true }
            });
            const regIds = regs.map(r => r.id);
            const refs = await prisma.refund.findMany({
                where: { registrationId: { in: regIds } },
                select: { id: true }
            });
            const refIds = refs.map(r => r.id);
            where.OR = [
                { sourceType: 'REGISTRATION', sourceId: { in: regIds } },
                { sourceType: 'REFUND', sourceId: { in: refIds } }
            ];
        }

        const entries = await prisma.financialLedgerEntry.findMany({ where });

        let grossRevenue = 0;
        let refunds = 0;
        let gatewayFees = 0;
        let platformFees = 0;

        entries.forEach(entry => {
            const amount = Number(entry.grossAmount || 0);
            const fee = Number(entry.gatewayFee || 0);
            const platFee = Number(entry.platformFee || 0);

            if (entry.direction === 'CREDIT') {
                grossRevenue += amount;
                gatewayFees += fee;
                platformFees += platFee;
            } else if (entry.direction === 'DEBIT') {
                refunds += amount;
            }
        });

        const arWhere: any = { tenantId: { in: tenantIds } };
        const apWhere: any = { tenantId: { in: tenantIds } };
        
        if (startDate || endDate) {
            arWhere.dueDate = {};
            apWhere.dueDate = {};
            if (startDate) {
                arWhere.dueDate.gte = new Date(startDate as string);
                apWhere.dueDate.gte = new Date(startDate as string);
            }
            if (endDate) {
                arWhere.dueDate.lte = new Date(endDate as string);
                apWhere.dueDate.lte = new Date(endDate as string);
            }
        }
        if (costCenterId) {
            arWhere.costCenterId = costCenterId as string;
            apWhere.costCenterId = costCenterId as string;
        }

        const [accountsReceivable, accountsPayable] = await Promise.all([
            prisma.accountsReceivable.findMany({ where: arWhere }),
            prisma.accountsPayable.findMany({ where: apWhere })
        ]);

        const arSum = accountsReceivable.reduce((sum, r) => sum + Number(r.amount || 0), 0);
        const apSum = accountsPayable.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const netRevenue = grossRevenue - refunds - gatewayFees - platformFees;

        res.json({
            dre: {
                grossRevenue,
                refunds,
                gatewayFees,
                platformFees,
                netRevenue
            },
            summary: {
                accountsReceivableTotal: arSum,
                accountsPayableTotal: apSum,
                accountsReceivableCount: accountsReceivable.length,
                accountsPayableCount: accountsPayable.length
            }
        });
    } catch (err) {
        console.error("DRE Fetch Error:", err);
        res.status(500).json({ message: 'Erro ao carregar DRE contábil' });
    }
});

// GET /finance/reconciliation - Bank Reconciliation comparing with Stripe
router.get('/reconciliation', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'TenantID obrigatório' });
        }

        const localEntries = await prisma.financialLedgerEntry.findMany({
            where: {
                tenantId,
                paymentProvider: 'STRIPE',
                stripeChargeId: { not: null }
            },
            orderBy: { createdAt: 'desc' },
            take: 100
        });

        const { stripe } = await import('../../services/stripeService.js');
        const isMaster = user.role === 'MASTER';
        let stripeChargesData: any[] = [];

        if (isMaster) {
            const listRes = await stripe.charges.list({ limit: 50 });
            stripeChargesData = listRes.data;
        } else {
            // Local First: resolve apenas as cobranças conhecidas do tenant
            const localStripeIds = Array.from(new Set(
                localEntries
                    .map(e => e.stripeChargeId)
                    .filter(Boolean) as string[]
            )).slice(0, 50);

            const resolvedCharges = await Promise.all(
                localStripeIds.map(async (id) => {
                    try {
                        return await stripe.charges.retrieve(id);
                    } catch (err) {
                        console.warn(`[Local-First Reconciliation] Could not retrieve charge ${id}:`, err);
                        return null;
                    }
                })
            );
            stripeChargesData = resolvedCharges.filter(Boolean);
        }

        const filteredCharges = stripeChargesData.filter(charge => {
            if (isMaster) return true;
            const chargeTenantId = charge.metadata?.tenantId;
            const hasLocalMatch = localEntries.some(e => e.stripeChargeId === charge.id || e.stripePaymentIntentId === (charge.payment_intent as string));
            return chargeTenantId === tenantId || hasLocalMatch;
        });

        const matched: any[] = [];
        const divergent: any[] = [];
        const missingLocally: any[] = [];
        const missingInStripe: any[] = [];

        for (const charge of filteredCharges) {
            const local = localEntries.find(e => e.stripeChargeId === charge.id || e.stripePaymentIntentId === (charge.payment_intent as string));
            const stripeAmount = charge.amount / 100;

            if (local) {
                const localAmount = Number(local.grossAmount);
                if (localAmount === stripeAmount) {
                    matched.push({
                        chargeId: charge.id,
                        paymentIntentId: charge.payment_intent,
                        amount: stripeAmount,
                        status: charge.status,
                        createdAt: new Date(charge.created * 1000),
                        localEntryId: local.id
                    });
                } else {
                    divergent.push({
                        chargeId: charge.id,
                        paymentIntentId: charge.payment_intent,
                        stripeAmount,
                        localAmount,
                        stripeStatus: charge.status,
                        localStatus: local.status,
                        createdAt: new Date(charge.created * 1000),
                        localEntryId: local.id
                    });
                }
            } else {
                const chargeTenantId = charge.metadata?.tenantId;
                if (isMaster || chargeTenantId === tenantId) {
                    missingLocally.push({
                        chargeId: charge.id,
                        paymentIntentId: charge.payment_intent,
                        amount: stripeAmount,
                        status: charge.status,
                        createdAt: new Date(charge.created * 1000)
                    });
                }
            }
        }

        for (const local of localEntries) {
            const hasCharge = filteredCharges.some(c => c.id === local.stripeChargeId || (c.payment_intent as string) === local.stripePaymentIntentId);
            if (!hasCharge) {
                missingInStripe.push({
                    entryId: local.id,
                    stripeChargeId: local.stripeChargeId,
                    stripePaymentIntentId: local.stripePaymentIntentId,
                    amount: Number(local.grossAmount),
                    status: local.status,
                    createdAt: local.createdAt
                });
            }
        }

        res.json({
            summary: {
                totalStripeChecked: stripeChargesData.length,
                totalLocalChecked: localEntries.length,
                matchedCount: matched.length,
                divergentCount: divergent.length,
                missingLocallyCount: missingLocally.length,
                missingInStripeCount: missingInStripe.length
            },
            matched,
            divergent,
            missingLocally,
            missingInStripe
        });
    } catch (err) {
        console.error("Reconciliation Error:", err);
        res.status(500).json({ message: 'Erro ao carregar conciliação bancária' });
    }
});

// GET /finance/payouts - List marketplace payouts
router.get('/payouts', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;

        if (!tenantId) return res.status(400).json({ message: 'TenantID obrigatório' });

        const payouts = await prisma.payoutLedger.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' }
        });

        res.json(payouts);
    } catch (err) {
        console.error("Payouts Fetch Error:", err);
        res.status(500).json({ message: 'Erro ao carregar repasses' });
    }
});

// POST /finance/payouts/release - Release pending payouts to available status
router.post('/payouts/release', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === Role.MASTER ? undefined : user.tenantId;
        const count = await PayoutService.releasePendingPayouts(tenantId || undefined);
        res.json({ success: true, releasedCount: count });
    } catch (err) {
        console.error("Payout Release Error:", err);
        res.status(500).json({ message: 'Erro ao liberar repasses' });
    }
});

// POST /finance/payouts/:id/complete - Complete a payout manual entry (MASTER only)
router.post('/payouts/:id/complete', authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const { stripeTransferId, stripePayoutId } = req.body;

        if (!stripeTransferId) {
            return res.status(400).json({ message: 'stripeTransferId é obrigatório' });
        }

        const payout = await PayoutService.completePayout(id, stripeTransferId, stripePayoutId);
        res.json(payout);
    } catch (err) {
        console.error("Payout Complete Error:", err);
        res.status(500).json({ message: 'Erro ao concluir repasse' });
    }
});

// ========== ACCOUNTS RECEIVABLE ==========

// GET /finance/accounts-receivable - List accounts receivable
router.get('/accounts-receivable', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'TenantID obrigatório' });

        const list = await prisma.accountsReceivable.findMany({
            where: { tenantId },
            orderBy: { dueDate: 'asc' }
        });
        res.json(list);
    } catch (err) {
        console.error("Accounts Receivable Fetch Error:", err);
        res.status(500).json({ message: 'Erro ao buscar contas a receber' });
    }
});

// POST /finance/accounts-receivable - Create accounts receivable
router.post('/accounts-receivable', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'TenantID obrigatório' });

        const { description, amount, dueDate, status, notes, costCenterId, categoryId } = req.body;
        if (!description || !amount || !dueDate) {
            return res.status(400).json({ message: 'Campos obrigatórios ausentes' });
        }

        const record = await prisma.accountsReceivable.create({
            data: {
                tenantId,
                description,
                amount,
                dueDate: new Date(dueDate),
                status: status || 'PENDING',
                notes,
                costCenterId,
                categoryId
            }
        });
        res.status(201).json(record);
    } catch (err) {
        console.error("Accounts Receivable Create Error:", err);
        res.status(500).json({ message: 'Erro ao criar conta a receber' });
    }
});

// PUT /finance/accounts-receivable/:id - Update accounts receivable
router.put('/accounts-receivable/:id', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;
        await assertTenantOwnership({ model: 'accountsReceivable', id, user });

        const { description, amount, dueDate, status, paidAt, paidAmount, receiptUrl, notes, costCenterId, categoryId } = req.body;

        const record = await prisma.accountsReceivable.update({
            where: { id },
            data: {
                description,
                amount,
                dueDate: dueDate ? new Date(dueDate) : undefined,
                status,
                paidAt: paidAt ? new Date(paidAt) : undefined,
                paidAmount,
                receiptUrl,
                notes,
                costCenterId,
                categoryId
            }
        });
        res.json(record);
    } catch (err: any) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        console.error("Accounts Receivable Update Error:", err);
        res.status(500).json({ message: 'Erro ao atualizar conta a receber' });
    }
});

// DELETE /finance/accounts-receivable/:id - Delete accounts receivable
router.delete('/accounts-receivable/:id', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;
        await assertTenantOwnership({ model: 'accountsReceivable', id, user });

        await prisma.accountsReceivable.delete({ where: { id } });
        res.status(204).send();
    } catch (err: any) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        console.error("Accounts Receivable Delete Error:", err);
        res.status(500).json({ message: 'Erro ao excluir conta a receber' });
    }
});

// ========== ACCOUNTS PAYABLE ==========

// GET /finance/accounts-payable - List accounts payable
router.get('/accounts-payable', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'TenantID obrigatório' });

        const list = await prisma.accountsPayable.findMany({
            where: { tenantId },
            orderBy: { dueDate: 'asc' }
        });
        res.json(list);
    } catch (err) {
        console.error("Accounts Payable Fetch Error:", err);
        res.status(500).json({ message: 'Erro ao buscar contas a pagar' });
    }
});

// POST /finance/accounts-payable - Create accounts payable
router.post('/accounts-payable', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'TenantID obrigatório' });

        const { description, amount, dueDate, status, providerId, notes, costCenterId, categoryId } = req.body;
        if (!description || !amount || !dueDate) {
            return res.status(400).json({ message: 'Campos obrigatórios ausentes' });
        }

        const record = await prisma.accountsPayable.create({
            data: {
                tenantId,
                providerId,
                description,
                amount,
                dueDate: new Date(dueDate),
                status: status || 'PENDING',
                notes,
                costCenterId,
                categoryId
            }
        });
        res.status(201).json(record);
    } catch (err) {
        console.error("Accounts Payable Create Error:", err);
        res.status(500).json({ message: 'Erro ao criar conta a pagar' });
    }
});

// PUT /finance/accounts-payable/:id - Update accounts payable
router.put('/accounts-payable/:id', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;
        await assertTenantOwnership({ model: 'accountsPayable', id, user });

        const { description, amount, dueDate, status, paidAt, paidAmount, receiptUrl, providerId, notes, costCenterId, categoryId } = req.body;

        const record = await prisma.accountsPayable.update({
            where: { id },
            data: {
                description,
                amount,
                dueDate: dueDate ? new Date(dueDate) : undefined,
                status,
                paidAt: paidAt ? new Date(paidAt) : undefined,
                paidAmount,
                receiptUrl,
                providerId,
                notes,
                costCenterId,
                categoryId
            }
        });
        res.json(record);
    } catch (err: any) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        console.error("Accounts Payable Update Error:", err);
        res.status(500).json({ message: 'Erro ao atualizar conta a pagar' });
    }
});

// DELETE /finance/accounts-payable/:id - Delete accounts payable
router.delete('/accounts-payable/:id', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;
        await assertTenantOwnership({ model: 'accountsPayable', id, user });

        await prisma.accountsPayable.delete({ where: { id } });
        res.status(204).send();
    } catch (err: any) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        console.error("Accounts Payable Delete Error:", err);
        res.status(500).json({ message: 'Erro ao excluir conta a pagar' });
    }
});

// ========== COST CENTERS & ACCOUNTING CATEGORIES ==========

// GET /finance/cost-centers - List cost centers
router.get('/cost-centers', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'TenantID obrigatório' });

        const list = await prisma.costCenter.findMany({
            where: { tenantId, active: true },
            orderBy: { name: 'asc' }
        });
        res.json(list);
    } catch (err) {
        console.error("Cost Centers Fetch Error:", err);
        res.status(500).json({ message: 'Erro ao buscar centros de custo' });
    }
});

// POST /finance/cost-centers - Create cost center
router.post('/cost-centers', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'TenantID obrigatório' });

        const { name, code, description } = req.body;
        if (!name) return res.status(400).json({ message: 'Nome é obrigatório' });

        const CC = await prisma.costCenter.create({
            data: {
                tenantId,
                name,
                code,
                description
            }
        });
        res.status(201).json(CC);
    } catch (err) {
        console.error("Cost Center Create Error:", err);
        res.status(500).json({ message: 'Erro ao criar centro de custo' });
    }
});

// GET /finance/accounting-categories - List accounting categories
router.get('/accounting-categories', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'TenantID obrigatório' });

        const list = await prisma.accountingCategory.findMany({
            where: { tenantId, active: true },
            orderBy: { name: 'asc' }
        });
        res.json(list);
    } catch (err) {
        console.error("Accounting Categories Fetch Error:", err);
        res.status(500).json({ message: 'Erro ao buscar categorias contábeis' });
    }
});

// POST /finance/accounting-categories - Create accounting category
router.post('/accounting-categories', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'TenantID obrigatório' });

        const { name, type, code, description } = req.body;
        if (!name || !type) return res.status(400).json({ message: 'Nome e tipo são obrigatórios' });

        const category = await prisma.accountingCategory.create({
            data: {
                tenantId,
                name,
                type,
                code,
                description
            }
        });
        res.status(201).json(category);
    } catch (err) {
        console.error("Accounting Category Create Error:", err);
        res.status(500).json({ message: 'Erro ao criar categoria contábil' });
    }
});

export const financeRouter = router;
