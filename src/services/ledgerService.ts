import { PrismaClient, FinancialTransaction, Refund, Role } from '@prisma/client';
import { prisma } from '../prisma.js';

/**
 * Sincroniza lançamentos no razão financeiro (FinancialLedgerEntry)
 * a partir de uma FinancialTransaction e seus reembolsos.
 */
export async function syncLedgerEntry(
  txPrisma: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
  transactionId: string
): Promise<void> {
  // 1. Buscar a transação com suas relações
  const tx = await txPrisma.financialTransaction.findUnique({
    where: { id: transactionId },
    include: {
      orders: true,
      donations: true,
      registrations: true,
      refunds: true
    }
  });

  if (!tx) {
    console.warn(`[LedgerService] FinancialTransaction ${transactionId} não encontrada.`);
    return;
  }

  // 2. Identificar a entidade de origem
  let sourceType = 'OTHER';
  let sourceId = tx.id;
  let platformFee = 0;

  if (tx.orders && tx.orders.length > 0) {
    sourceType = 'ORDER';
    sourceId = tx.orders[0].id;
    platformFee = Number(tx.orders[0].platformFee || 0);
  } else if (tx.donations && tx.donations.length > 0) {
    sourceType = 'DONATION';
    sourceId = tx.donations[0].id;
    platformFee = Number(tx.donations[0].platformFee || 0);
  } else if (tx.registrations && tx.registrations.length > 0) {
    sourceType = 'REGISTRATION';
    sourceId = tx.registrations[0].id;
  } else if (tx.source === 'SPONSORSHIP') {
    sourceType = 'SPONSORSHIP';
  } else if (tx.source === 'THEATER') {
    sourceType = 'THEATER';
  }

  // 3. Upsert do lançamento principal (CREDIT)
  const mainEntryKey = `tx-${tx.id}-credit`;
  const mainStatus = (tx.status === 'COMPLETED' || tx.status === 'REFUNDED' || tx.status === 'PARTIALLY_REFUNDED')
                     ? 'COMPLETED'
                     : tx.status;

  await txPrisma.financialLedgerEntry.upsert({
    where: { idempotencyKey: mainEntryKey },
    create: {
      tenantId: tx.tenantId,
      sourceType,
      sourceId,
      direction: 'CREDIT',
      grossAmount: tx.amount,
      gatewayFee: tx.fee,
      platformFee: platformFee,
      netAmount: tx.netAmount,
      currency: 'BRL',
      status: mainStatus,
      paymentMethod: tx.paymentMethod,
      stripePaymentIntentId: tx.stripePaymentIntentId,
      stripeChargeId: tx.stripeChargeId,
      idempotencyKey: mainEntryKey,
      competenceDate: tx.createdAt,
      settlementDate: tx.status === 'COMPLETED' ? tx.updatedAt : null
    },
    update: {
      status: mainStatus,
      gatewayFee: tx.fee,
      netAmount: tx.netAmount,
      stripePaymentIntentId: tx.stripePaymentIntentId,
      stripeChargeId: tx.stripeChargeId,
      settlementDate: tx.status === 'COMPLETED' ? tx.updatedAt : null
    }
  });

  // 4. Sincronizar lançamentos de reembolsos associados (DEBIT)
  if (tx.refunds && tx.refunds.length > 0) {
    for (const ref of tx.refunds) {
      if (ref.status !== 'COMPLETED') continue;

      const refundEntryKey = `ref-${ref.id}-debit`;
      // No reembolso, o valor líquido retirado é o valor do reembolso.
      // A taxa de gateway/plataforma não costuma ser estornada pelo Stripe, mas podemos registrar.
      await txPrisma.financialLedgerEntry.upsert({
        where: { idempotencyKey: refundEntryKey },
        create: {
          tenantId: tx.tenantId,
          sourceType: 'REFUND',
          sourceId: ref.id,
          direction: 'DEBIT',
          grossAmount: ref.amount,
          gatewayFee: 0,
          platformFee: 0,
          netAmount: ref.amount, // debit retira esse valor líquido
          currency: 'BRL',
          status: 'COMPLETED',
          paymentMethod: tx.paymentMethod,
          stripeRefundId: ref.stripeRefundId,
          idempotencyKey: refundEntryKey,
          competenceDate: ref.createdAt,
          settlementDate: ref.updatedAt
        },
        update: {
          status: 'COMPLETED',
          stripeRefundId: ref.stripeRefundId,
          settlementDate: ref.updatedAt
        }
      });
    }
  }
}

/**
 * Reconstrói todo o razão financeiro de um tenant a partir das transações históricas.
 */
export async function rebuildLedger(tenantId: string): Promise<{ success: boolean; count: number }> {
  const transactions = await prisma.financialTransaction.findMany({
    where: { tenantId }
  });

  let count = 0;
  await prisma.$transaction(async (txPrisma) => {
    // Limpa lançamentos antigos do ledger para evitar inconsistência
    await txPrisma.financialLedgerEntry.deleteMany({
      where: { tenantId }
    });

    for (const tx of transactions) {
      await syncLedgerEntry(txPrisma, tx.id);
      count++;
    }
  });

  return { success: true, count };
}
