/**
 * ======================================================
 * MÓDULO FINANCEIRO COMPLETO — ERP
 * /financial — ADMIN/MASTER only
 *
 * Endpoints existentes:
 *  GET  /financial/summary
 *  GET  /financial/statement
 *  GET  /financial/receivables
 *  POST /financial/receivables
 *  PUT  /financial/receivables/:id
 *  GET  /financial/payables
 *  POST /financial/payables
 *  PUT  /financial/payables/:id
 *  POST /financial/refund/:transactionId
 *  GET  /financial/refunds
 *  GET  /financial/reconciliation
 *  GET  /financial/payouts
 *  GET  /financial/disputes
 *
 * Endpoints ERP adicionados:
 *  PUT  /financial/receivables/:id/baixa     — Baixa formal com data/comprovante
 *  PUT  /financial/payables/:id/baixa        — Baixa formal com data/comprovante
 *  GET  /financial/export                    — Exportação CSV/JSON de transações
 *  GET  /financial/cost-centers             — Listar centros de custo
 *  POST /financial/cost-centers             — Criar centro de custo
 *  PUT  /financial/cost-centers/:id         — Atualizar centro de custo
 *  GET  /financial/categories               — Listar categorias contábeis
 *  POST /financial/categories               — Criar categoria contábil
 *  PUT  /financial/categories/:id           — Atualizar categoria contábil
 *  GET  /financial/chargebacks              — Listar chargebacks salvos no banco
 * ======================================================
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { Role } from '@prisma/client';
import { stripe } from '../../services/stripeService.js';
import { z } from 'zod';

const router = Router();

// All routes require auth
router.use(authMiddleware);
router.use(requireRole([Role.ADMIN, Role.MASTER]));

// Helper: resolve tenantId (MASTER pode usar query param, ADMIN usa o próprio)
function resolveTenant(req: Request): string | null {
  const user = req.user!;
  if (user.role === 'MASTER' && req.query.tenantId) return req.query.tenantId as string;
  return user.tenantId || null;
}

// ==========================================
// GET /financial/summary
// ==========================================
router.get('/summary', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const [
    totalRevenue,
    totalFees,
    pendingReceivables,
    overduePayables,
    pendingRefunds,
    txCount
  ] = await Promise.all([
    // Receita total confirmada
    prisma.financialTransaction.aggregate({
      where: { tenantId, status: 'COMPLETED' },
      _sum: { netAmount: true, amount: true, fee: true }
    }),
    // Taxas acumuladas pagas à plataforma
    prisma.financialTransaction.aggregate({
      where: { tenantId, status: 'COMPLETED' },
      _sum: { fee: true }
    }),
    // Contas a receber pendentes
    prisma.accountsReceivable.aggregate({
      where: { tenantId, status: 'PENDING' },
      _sum: { amount: true },
      _count: true
    }),
    // Contas a pagar vencidas
    prisma.accountsPayable.aggregate({
      where: { tenantId, status: 'PENDING', dueDate: { lt: new Date() } },
      _sum: { amount: true },
      _count: true
    }),
    // Reembolsos pendentes
    prisma.refund.count({ where: { tenantId, status: 'PENDING' } }),
    // Total de transações
    prisma.financialTransaction.count({ where: { tenantId } })
  ]);

  return res.json({
    tenantId,
    revenue: {
      gross: Number(totalRevenue._sum.amount ?? 0),
      fees: Number(totalRevenue._sum.fee ?? 0),
      net: Number(totalRevenue._sum.netAmount ?? 0),
      transactionCount: txCount
    },
    receivables: {
      pendingTotal: Number(pendingReceivables._sum.amount ?? 0),
      pendingCount: pendingReceivables._count
    },
    payables: {
      overdueTotal: Number(overduePayables._sum.amount ?? 0),
      overdueCount: overduePayables._count
    },
    pendingRefunds
  });
});

// ==========================================
// GET /financial/statement
// Extrato unificado de todas as transações financeiras
// ==========================================
router.get('/statement', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const page  = Math.max(1, parseInt(req.query.page as string || '1'));
  const limit = Math.min(100, parseInt(req.query.limit as string || '20'));
  const skip  = (page - 1) * limit;

  const { source, status, startDate, endDate } = req.query;

  const where: any = { tenantId };
  if (source) where.source = source;
  if (status) where.status = status;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate as string);
    if (endDate)   where.createdAt.lte = new Date(endDate as string);
  }

  const [transactions, total] = await Promise.all([
    prisma.financialTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.financialTransaction.count({ where })
  ]);

  return res.json({
    data: transactions,
    meta: { total, page, limit, pages: Math.ceil(total / limit) }
  });
});

// ==========================================
// GET /financial/receivables
// ==========================================
router.get('/receivables', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const status = req.query.status as string | undefined;
  const where: any = { tenantId };
  if (status) where.status = status;

  const items = await prisma.accountsReceivable.findMany({
    where,
    orderBy: { dueDate: 'asc' }
  });

  return res.json(items);
});

// ==========================================
// POST /financial/receivables
// ==========================================
const receivableSchema = z.object({
  description: z.string().min(1),
  amount:      z.number().positive(),
  dueDate:     z.string().datetime()
});

router.post('/receivables', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const parse = receivableSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ errors: parse.error.errors });

  const item = await prisma.accountsReceivable.create({
    data: {
      tenantId,
      description: parse.data.description,
      amount:      parse.data.amount,
      dueDate:     new Date(parse.data.dueDate),
      status:      'PENDING'
    }
  });

  return res.status(201).json(item);
});

// ==========================================
// PUT /financial/receivables/:id
// ==========================================
router.put('/receivables/:id', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const { id } = req.params;
  const { status, description, amount, dueDate } = req.body;

  const existing = await prisma.accountsReceivable.findFirst({ where: { id, tenantId } });
  if (!existing) return res.status(404).json({ message: 'Conta a receber não encontrada' });

  const updated = await prisma.accountsReceivable.update({
    where: { id },
    data: {
      ...(status      && { status }),
      ...(description && { description }),
      ...(amount      && { amount }),
      ...(dueDate     && { dueDate: new Date(dueDate) })
    }
  });

  return res.json(updated);
});

// ==========================================
// GET /financial/payables
// ==========================================
router.get('/payables', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const status = req.query.status as string | undefined;
  const where: any = { tenantId };
  if (status) where.status = status;

  const items = await prisma.accountsPayable.findMany({
    where,
    orderBy: { dueDate: 'asc' }
  });

  return res.json(items);
});

// ==========================================
// POST /financial/payables
// ==========================================
const payableSchema = z.object({
  description: z.string().min(1),
  amount:      z.number().positive(),
  dueDate:     z.string().datetime(),
  providerId:  z.string().optional()
});

router.post('/payables', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const parse = payableSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ errors: parse.error.errors });

  const item = await prisma.accountsPayable.create({
    data: {
      tenantId,
      description: parse.data.description,
      amount:      parse.data.amount,
      dueDate:     new Date(parse.data.dueDate),
      providerId:  parse.data.providerId,
      status:      'PENDING'
    }
  });

  return res.status(201).json(item);
});

// ==========================================
// PUT /financial/payables/:id
// ==========================================
router.put('/payables/:id', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const { id } = req.params;
  const { status, description, amount, dueDate } = req.body;

  const existing = await prisma.accountsPayable.findFirst({ where: { id, tenantId } });
  if (!existing) return res.status(404).json({ message: 'Conta a pagar não encontrada' });

  const updated = await prisma.accountsPayable.update({
    where: { id },
    data: {
      ...(status      && { status }),
      ...(description && { description }),
      ...(amount      && { amount }),
      ...(dueDate     && { dueDate: new Date(dueDate) })
    }
  });

  return res.json(updated);
});

// ==========================================
// POST /financial/refund/:transactionId
// Emite refund real no Stripe e registra no banco
// ==========================================
const refundSchema = z.object({
  amount: z.number().positive().optional(), // Se omitido, reembolso total
  reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).optional()
});

router.post('/refund/:transactionId', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const parse = refundSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ errors: parse.error.errors });

  const { transactionId } = req.params;

  // 1. Encontrar a transação financeira
  const tx = await prisma.financialTransaction.findFirst({
    where: { id: transactionId, tenantId }
  });

  if (!tx) return res.status(404).json({ message: 'Transação não encontrada' });
  if (tx.status === 'REFUNDED') return res.status(400).json({ message: 'Esta transação já foi reembolsada' });
  if (!tx.stripePaymentIntentId && !tx.stripeChargeId) {
    return res.status(400).json({ message: 'Transação sem ID Stripe — reembolso manual necessário' });
  }

  const refundAmountCents = parse.data.amount
    ? Math.round(parse.data.amount * 100)
    : undefined; // undefined = reembolso total

  try {
    // 2. Emitir refund no Stripe
    const stripeRefund = await stripe.refunds.create({
      ...(tx.stripeChargeId
        ? { charge: tx.stripeChargeId }
        : { payment_intent: tx.stripePaymentIntentId! }),
      ...(refundAmountCents && { amount: refundAmountCents }),
      reason: (parse.data.reason || 'requested_by_customer') as any
    });

    const refundedAmount = stripeRefund.amount / 100;

    // 3. Registrar no banco em transação atômica
    const refundRecord = await prisma.$transaction(async (txPrisma) => {
      const createdRefund = await txPrisma.refund.create({
        data: {
          transactionId: tx.id,
          tenantId,
          amount:        refundedAmount,
          reason:        parse.data.reason || 'requested_by_customer',
          status:        stripeRefund.status === 'succeeded' ? 'COMPLETED' : 'PENDING',
          stripeRefundId: stripeRefund.id
        }
      });

      // Calcular o montante total reembolsado até agora
      const allCompletedRefunds = await txPrisma.refund.findMany({
        where: { transactionId: tx.id, status: 'COMPLETED' }
      });

      const totalRefunded = allCompletedRefunds.reduce((sum, r) => sum + Number(r.amount), 0);
      const isFullRefund = totalRefunded >= Number(tx.amount);
      
      const finalTxStatus = isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      const pendingStatus = isFullRefund ? 'REFUND_PENDING' : 'PARTIAL_REFUND_PENDING';

      // Atualizar status da transação financeira de acordo com o total reembolsado
      await txPrisma.financialTransaction.update({
        where: { id: tx.id },
        data: {
          status: stripeRefund.status === 'succeeded' ? finalTxStatus : pendingStatus
        }
      });

      // 4. Update the related source objects on full refund to keep dashboards consistent
      if (stripeRefund.status === 'succeeded' && isFullRefund) {
        // A. Registrations (Tickets)
        const registrations = await txPrisma.registration.findMany({
          where: { financialTransactionId: tx.id }
        });
        for (const reg of registrations) {
          await txPrisma.registration.update({
            where: { id: reg.id },
            data: { status: "CANCELED" }
          });
          // Decrement ticket sold count
          await txPrisma.ticket.update({
            where: { id: reg.ticketId },
            data: { sold: { decrement: 1 } }
          });
        }

        // B. Orders
        await txPrisma.order.updateMany({
          where: { financialTransactionId: tx.id },
          data: { status: "REFUNDED" }
        });

        // C. Donations
        await txPrisma.donation.updateMany({
          where: { financialTransactionId: tx.id },
          data: { status: "REFUNDED" }
        });

        // D. Transactions (Chat)
        await txPrisma.transaction.updateMany({
          where: { financialTransactionId: tx.id },
          data: { status: "REFUNDED" }
        });

        // E. Memberships
        if (tx.stripePaymentIntentId) {
          await txPrisma.membership.updateMany({
            where: { paymentId: tx.stripePaymentIntentId },
            data: { status: "CANCELLED", cancelledAt: new Date() }
          });
        }
      }

      return createdRefund;
    });

    return res.json({
      message: 'Reembolso processado com sucesso',
      refund: refundRecord,
      stripeRefundId: stripeRefund.id,
      stripeStatus: stripeRefund.status
    });

  } catch (err: any) {
    console.error('[Financial] Erro ao emitir refund:', err);
    return res.status(500).json({
      message: 'Erro ao processar reembolso no Stripe',
      detail: err?.message
    });
  }
});

// ==========================================
// GET /financial/refunds
// ==========================================
router.get('/refunds', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const refunds = await prisma.refund.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' }
  });

  return res.json(refunds);
});

// ==========================================
// GET /financial/reconciliation
// Conciliação: cruza FinancialTransaction com Stripe
// Detecta: (1) transações no banco sem Stripe ID, (2) discrepâncias de valor
// ==========================================
router.get('/reconciliation', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const { startDate, endDate } = req.query;

  const where: any = { tenantId, status: 'COMPLETED' };
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate as string);
    if (endDate)   where.createdAt.lte = new Date(endDate as string);
  }

  // 1. Transações locais
  const localTxs = await prisma.financialTransaction.findMany({ where });

  const reconciled: any[]   = [];
  const unmatched: any[]    = [];
  const discrepancies: any[] = [];

  // 2. Para cada transação local com stripePaymentIntentId, verificar no Stripe
  for (const tx of localTxs) {
    if (!tx.stripePaymentIntentId) {
      unmatched.push({ ...tx, reason: 'Sem stripePaymentIntentId' });
      continue;
    }

    try {
      const pi = await stripe.paymentIntents.retrieve(tx.stripePaymentIntentId);
      const stripeAmountCents = pi.amount_received;
      const localAmountCents  = Math.round(Number(tx.amount) * 100);

      if (Math.abs(stripeAmountCents - localAmountCents) > 1) { // tolerância de 1 centavo
        discrepancies.push({
          transactionId: tx.id,
          stripePaymentIntentId: tx.stripePaymentIntentId,
          localAmount: Number(tx.amount),
          stripeAmount: stripeAmountCents / 100,
          diff: (stripeAmountCents - localAmountCents) / 100
        });
      } else {
        reconciled.push({ transactionId: tx.id, stripePaymentIntentId: tx.stripePaymentIntentId });
      }
    } catch (e: any) {
      unmatched.push({
        transactionId: tx.id,
        stripePaymentIntentId: tx.stripePaymentIntentId,
        reason: `Erro Stripe: ${e?.message}`
      });
    }
  }

  return res.json({
    summary: {
      total:        localTxs.length,
      reconciled:   reconciled.length,
      unmatched:    unmatched.length,
      discrepancies: discrepancies.length
    },
    reconciled,
    unmatched,
    discrepancies
  });
});

// ==========================================
// GET /financial/payouts
// Histórico de repasses (payouts) via Stripe Connect
// ==========================================
router.get('/payouts', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  // Busca a conta Stripe Connect do tenant
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeConnectId: true, name: true }
  });

  if (!tenant?.stripeConnectId) {
    return res.status(400).json({
      message: 'Tenant sem conta Stripe Connect. Configure o onboarding primeiro.'
    });
  }

  try {
    const limit = Math.min(100, parseInt(req.query.limit as string || '20'));

    // Lista payouts da conta Connect do tenant
    const payouts = await stripe.payouts.list(
      { limit },
      { stripeAccount: tenant.stripeConnectId }
    );

    // Sincroniza payouts com a tabela local PayoutLedger
    if (payouts.data && payouts.data.length > 0) {
      await Promise.all(
        payouts.data.map(async (p) => {
          const val = p.amount / 100;
          await prisma.payoutLedger.upsert({
            where: { stripePayoutId: p.id },
            create: {
              tenantId,
              stripePayoutId: p.id,
              amount: val,
              fee: 0,
              netAmount: val,
              status: p.status.toUpperCase(),
              currency: p.currency.toUpperCase(),
              arrivalDate: new Date(p.arrival_date * 1000)
            },
            update: {
              status: p.status.toUpperCase(),
              arrivalDate: new Date(p.arrival_date * 1000)
            }
          });
        })
      );
    }

    // Busca os dados consolidados do ledger local do banco de dados
    const localPayouts = await prisma.payoutLedger.findMany({
      where: { tenantId },
      orderBy: { arrivalDate: 'desc' },
      take: limit
    });

    return res.json({
      tenantId,
      stripeConnectId: tenant.stripeConnectId,
      payouts: localPayouts.map(p => ({
        id:           p.stripePayoutId,
        amount:       Number(p.amount),
        fee:          Number(p.fee),
        netAmount:    Number(p.netAmount),
        status:       p.status.toLowerCase(),
        arrivalDate:  p.arrivalDate ? p.arrivalDate.toISOString() : null,
        currency:     p.currency
      })),
      hasMore: payouts.has_more
    });

  } catch (err: any) {
    console.error('[Financial] Erro ao listar payouts:', err);
    return res.status(500).json({
      message: 'Erro ao buscar payouts no Stripe',
      detail: err?.message
    });
  }
});

// ==========================================
// GET /financial/disputes
// Disputas e chargebacks da conta Connect
// ==========================================
router.get('/disputes', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeConnectId: true }
  });

  if (!tenant?.stripeConnectId) {
    return res.status(400).json({ message: 'Tenant sem conta Stripe Connect' });
  }

  try {
    const disputes = await stripe.disputes.list(
      { limit: 20 },
      { stripeAccount: tenant.stripeConnectId }
    );

    return res.json({
      tenantId,
      disputes: disputes.data.map(d => ({
        id:           d.id,
        amount:       d.amount / 100,
        currency:     d.currency.toUpperCase(),
        status:       d.status,
        reason:       d.reason,
        chargeId:     d.charge,
        created:      new Date(d.created * 1000).toISOString(),
        dueBy:        d.evidence_details?.due_by
                        ? new Date(d.evidence_details.due_by * 1000).toISOString()
                        : null,
        hasEvidence:  d.evidence_details?.has_evidence ?? false
      })),
      hasMore: disputes.has_more
    });

  } catch (err: any) {
    console.error('[Financial] Erro ao listar disputes:', err);
    return res.status(500).json({
      message: 'Erro ao buscar disputas no Stripe',
      detail: err?.message
    });
  }
});

// ==========================================
// PUT /financial/receivables/:id/baixa
// Baixa formal de conta a receber (data de pagamento + comprovante)
// ==========================================
const baixaSchema = z.object({
  paidAt:     z.string().datetime(),
  paidAmount: z.number().positive().optional(),
  receiptUrl: z.string().url().optional(),
  notes:      z.string().optional()
});

router.put('/receivables/:id/baixa', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const parse = baixaSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ errors: parse.error.errors });

  const existing = await prisma.accountsReceivable.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ message: 'Conta a receber não encontrada' });
  if (existing.status === 'RECEIVED') return res.status(400).json({ message: 'Conta já baixada' });

  const updated = await prisma.accountsReceivable.update({
    where: { id: req.params.id },
    data: {
      status:     'RECEIVED',
      paidAt:     new Date(parse.data.paidAt),
      paidAmount: parse.data.paidAmount ?? Number(existing.amount),
      receiptUrl: parse.data.receiptUrl,
      notes:      parse.data.notes
    }
  });
  return res.json(updated);
});

// ==========================================
// PUT /financial/payables/:id/baixa
// Baixa formal de conta a pagar
// ==========================================
router.put('/payables/:id/baixa', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const parse = baixaSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ errors: parse.error.errors });

  const existing = await prisma.accountsPayable.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ message: 'Conta a pagar não encontrada' });
  if (existing.status === 'PAID') return res.status(400).json({ message: 'Conta já baixada' });

  const updated = await prisma.accountsPayable.update({
    where: { id: req.params.id },
    data: {
      status:     'PAID',
      paidAt:     new Date(parse.data.paidAt),
      paidAmount: parse.data.paidAmount ?? Number(existing.amount),
      receiptUrl: parse.data.receiptUrl,
      notes:      parse.data.notes
    }
  });
  return res.json(updated);
});

function escapeCSVField(val: any): string {
  if (val === null || val === undefined) return '';
  let str = String(val);
  if (str.startsWith('=') || str.startsWith('+') || str.startsWith('-') || str.startsWith('@') || str.startsWith('\r') || str.startsWith('\t')) {
    str = "'" + str;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ==========================================
// GET /financial/export
// Exportação contábil de transações (CSV ou JSON)
// ==========================================
router.get('/export', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const { startDate, endDate, format = 'json', source, status } = req.query;

  const where: any = { tenantId };
  if (source) where.source = source;
  if (status) where.status = status;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate as string);
    if (endDate)   where.createdAt.lte = new Date(endDate as string);
  }

  const transactions = await prisma.financialTransaction.findMany({
    where,
    orderBy: { createdAt: 'asc' }
  });

  if (format === 'csv') {
    const header = 'id,tipo,fonte,valor_bruto,taxa,valor_liquido,status,metodo_pagamento,data\n';
    const rows = transactions.map(t =>
      [
        escapeCSVField(t.id),
        escapeCSVField(t.type),
        escapeCSVField(t.source),
        escapeCSVField(Number(t.amount).toFixed(2)),
        escapeCSVField(Number(t.fee).toFixed(2)),
        escapeCSVField(Number(t.netAmount).toFixed(2)),
        escapeCSVField(t.status),
        escapeCSVField(t.paymentMethod),
        escapeCSVField(t.createdAt.toISOString())
      ].join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="extrato_${tenantId}_${Date.now()}.csv"`);
    return res.send(header + rows);
  }

  // JSON padrão
  return res.json({
    tenantId,
    exported: transactions.length,
    period: { startDate: startDate || null, endDate: endDate || null },
    data: transactions
  });
});

// ==========================================
// GET /financial/cost-centers
// ==========================================
router.get('/cost-centers', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const items = await prisma.costCenter.findMany({
    where: { tenantId, active: true },
    orderBy: { code: 'asc' }
  });
  return res.json(items);
});

// ==========================================
// POST /financial/cost-centers
// ==========================================
const costCenterSchema = z.object({
  name:        z.string().min(1),
  code:        z.string().optional(),
  description: z.string().optional()
});

router.post('/cost-centers', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const parse = costCenterSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ errors: parse.error.errors });

  const item = await prisma.costCenter.create({
    data: { tenantId, ...parse.data }
  });
  return res.status(201).json(item);
});

// ==========================================
// PUT /financial/cost-centers/:id
// ==========================================
router.put('/cost-centers/:id', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const existing = await prisma.costCenter.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ message: 'Centro de custo não encontrado' });

  const { name, code, description, active } = req.body;
  const updated = await prisma.costCenter.update({
    where: { id: req.params.id },
    data: {
      ...(name        !== undefined && { name }),
      ...(code        !== undefined && { code }),
      ...(description !== undefined && { description }),
      ...(active      !== undefined && { active })
    }
  });
  return res.json(updated);
});

// ==========================================
// GET /financial/categories
// ==========================================
router.get('/categories', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const { type } = req.query; // REVENUE | EXPENSE
  const where: any = { tenantId, active: true };
  if (type) where.type = type;

  const items = await prisma.accountingCategory.findMany({
    where,
    orderBy: { code: 'asc' }
  });
  return res.json(items);
});

// ==========================================
// POST /financial/categories
// ==========================================
const categorySchema = z.object({
  name:        z.string().min(1),
  type:        z.enum(['REVENUE', 'EXPENSE']),
  code:        z.string().optional(),
  description: z.string().optional()
});

router.post('/categories', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const parse = categorySchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ errors: parse.error.errors });

  const item = await prisma.accountingCategory.create({
    data: { tenantId, ...parse.data }
  });
  return res.status(201).json(item);
});

// ==========================================
// PUT /financial/categories/:id
// ==========================================
router.put('/categories/:id', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const existing = await prisma.accountingCategory.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ message: 'Categoria não encontrada' });

  const { name, code, description, type, active } = req.body;
  const updated = await prisma.accountingCategory.update({
    where: { id: req.params.id },
    data: {
      ...(name        !== undefined && { name }),
      ...(code        !== undefined && { code }),
      ...(description !== undefined && { description }),
      ...(type        !== undefined && { type }),
      ...(active      !== undefined && { active })
    }
  });
  return res.json(updated);
});

// ==========================================
// GET /financial/chargebacks
// Chargebacks salvos localmente no banco (sincronizados via webhook)
// ==========================================
router.get('/chargebacks', async (req: Request, res: Response): Promise<any> => {
  const tenantId = resolveTenant(req);
  if (!tenantId) return res.status(400).json({ message: 'TenantId obrigatório' });

  const { status } = req.query;
  const where: any = { tenantId };
  if (status) where.status = status;

  const chargebacks = await prisma.chargeback.findMany({
    where,
    orderBy: { createdAt: 'desc' }
  });

  return res.json(chargebacks);
});

export default router;
