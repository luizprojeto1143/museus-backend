/**
 * src/utils/fees.ts
 *
 * Módulo de compatibilidade legada de taxas.
 * Delega o cálculo para o novo `fee.service.ts`.
 */

import { getPlatformFee } from '../services/fee.service.js';
import { PlatformFeeSource } from '@prisma/client';

/**
 * Retorna a taxa decimal da plataforma para um tenant específico (legacy).
 * Ex: se a taxa for 5%, retorna 0.05.
 * 
 * Uso herdado: const fee = await getPlatformFeeRate(tenantId);
 */
export async function getPlatformFeeRate(tenantId: string | null | undefined): Promise<number> {
  try {
    const feeResult = await getPlatformFee({
      tenantId,
      sourceType: PlatformFeeSource.TICKET, // Usa TICKET como fallback genérico de compatibilidade
      amountCents: 10000
    });
    return feeResult.percentage / 100;
  } catch {
    return 0.05;
  }
}

/**
 * Versão síncrona legado.
 */
export function getPlatformFeeRateFromValue(feePercentage: number | null | undefined): number {
  if (feePercentage != null) return feePercentage / 100;
  return 0.05;
}
