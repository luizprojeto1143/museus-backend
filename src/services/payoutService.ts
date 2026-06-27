import { prisma } from '../prisma.js';
import { PayoutLedger } from '@prisma/client';

export class PayoutService {
  /**
   * Registra um novo repasse (PayoutLedger) a partir de uma transação concluída.
   * Divide o valor bruto calculando taxas de plataforma e taxas de gateway.
   */
  static async registerPayout(params: {
    tenantId: string;
    recipientType: 'MUSEUM' | 'PROVIDER';
    recipientId: string;
    sourceTransactionId?: string;
    grossAmount: number;
    platformFeeRate?: number; // percentual, ex: 0.05 para 5%
    gatewayFee?: number;
  }): Promise<PayoutLedger> {
    const gross = params.grossAmount;
    const gateway = params.gatewayFee || 0;
    const rate = params.platformFeeRate || 0.03; // Padrão 3%
    const platform = parseFloat((gross * rate).toFixed(2));
    const net = parseFloat((gross - platform - gateway).toFixed(2));

    return await prisma.payoutLedger.create({
      data: {
        tenantId: params.tenantId,
        recipientType: params.recipientType,
        recipientId: params.recipientId,
        sourceTransactionId: params.sourceTransactionId || null,
        grossAmount: gross,
        platformFee: platform,
        gatewayFee: gateway,
        netAmount: net,
        status: 'PENDING',
        currency: 'BRL',
        availableAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // Disponível em 14 dias por padrão
      }
    });
  }

  /**
   * Libera repasses vencidos (passados de availableAt) alterando o status de PENDING para AVAILABLE.
   */
  static async releasePendingPayouts(tenantId?: string): Promise<number> {
    const now = new Date();
    const where: any = {
      status: 'PENDING',
      availableAt: { lte: now }
    };
    if (tenantId) {
      where.tenantId = tenantId;
    }
    const result = await prisma.payoutLedger.updateMany({
      where,
      data: {
        status: 'AVAILABLE'
      }
    });
    return result.count;
  }

  /**
   * Atualiza o repasse para status PAID após confirmação de transferência do Stripe.
   */
  static async completePayout(
    payoutId: string,
    stripeTransferId: string,
    stripePayoutId?: string
  ): Promise<PayoutLedger> {
    return await prisma.payoutLedger.update({
      where: { id: payoutId },
      data: {
        status: 'PAID',
        stripeTransferId,
        stripePayoutId: stripePayoutId || null,
        paidAt: new Date()
      }
    });
  }
}
