import { prisma } from '../prisma.js';

/**
 * Retorna a taxa da plataforma para um tenant específico.
 * Lê tenant.feePercentage do banco. Fallback: 5%.
 * 
 * Uso: const fee = await getPlatformFeeRate(tenantId);
 *      const platformFee = amount * fee; // ex: 100 * 0.05 = 5
 */
export async function getPlatformFeeRate(tenantId: string | null | undefined): Promise<number> {
  if (!tenantId) return 0.05; // fallback padrão

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { feePercentage: true }
    });
    // feePercentage é armazenado como número inteiro (ex: 5 = 5%)
    if (tenant?.feePercentage != null) {
      return tenant.feePercentage / 100;
    }
  } catch {
    // Silencioso — fallback para 5%
  }

  return 0.05;
}

/**
 * Versão síncrona com valor já carregado do banco.
 * Use quando já tem feePercentage disponível no tenant object.
 */
export function getPlatformFeeRateFromValue(feePercentage: number | null | undefined): number {
  if (feePercentage != null) return feePercentage / 100;
  return 0.05;
}
