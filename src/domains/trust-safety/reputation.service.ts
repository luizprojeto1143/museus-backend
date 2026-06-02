import { prisma } from '../../prisma.js';
import { logger } from '../../infrastructure/logger/pino.logger.js';

export class ReputationService {
  /**
   * Calcula o Trust Score de um usuário ou parceiro.
   * Retorna um score de 0 a 100.
   */
  async calculateTrustScore(userId: string, role: 'PROVIDER' | 'VISITOR'): Promise<number> {
    console.log(`[Trust & Safety] Calculating risk score for ${role} ${userId}`);
    
    let score = 100;

    // 1. Verificar histórico de avaliações bloqueadas/denunciadas (real)
    let activeReports = 0;
    if (role === 'PROVIDER') {
      const rejectedReviews = await prisma.reviewModeration.count({
        where: {
          isApproved: false,
          flagReason: { in: ['OFFENSIVE', 'SPAM', 'SCAM'] }
        }
      });
      activeReports = rejectedReviews;
    }
    score -= (activeReports * 20);

    // 2. Verificar anomalias de transação (chargebacks/falhas reais)
    const chargebacks = await prisma.transaction.count({
      where: {
        OR: [
          { payerId: userId },
          { payeeId: userId }
        ],
        status: { in: ['FAILED', 'REFUNDED'] }
      }
    });
    score -= (chargebacks * 50);

    // 3. Verificação de Identidade (KYC)
    // Em produção, isso integraria com serviços como Truora, idwall ou similar.
    const kycVerified = await this.checkKYCStatus(userId, role);
    if (!kycVerified) {
      score -= 30; // Penalidade pesada por não ter identidade validada
    }
    
    // Se a pontuação cair muito, tomamos ações automáticas
    if (score < 40) {
      console.warn(`[🚨 ALERTA] Risco Alto detectado para ${userId}. Shadowban ativado.`);
      await this.applyShadowban(userId, role);
    }

    return Math.max(0, score);
  }

  private async applyShadowban(userId: string, role: 'PROVIDER' | 'VISITOR') {
    // Lógica para esconder os produtos do parceiro do Marketplace
    if (role === 'PROVIDER') {
      await prisma.providerProduct.updateMany({
        where: { serviceProviderId: userId },
        data: { active: false } // Suspende produtos preventivamente
      });
      // Poderíamos disparar um evento para alertar o Master
    }
  }

  private async checkKYCStatus(userId: string, role: 'PROVIDER' | 'VISITOR'): Promise<boolean> {
    // Stub: Em produção bateríamos em uma tabela de KYC (Know Your Customer)
    // Para provedores (B2B), a validação de CNPJ seria mandatória
    logger.info(`[KYC] Verificando status de identidade para ${userId}`);
    // Simulando que alguns não validaram ainda
    return true; 
  }
}
