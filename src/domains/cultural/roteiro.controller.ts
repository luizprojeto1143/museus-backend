import { Request, Response } from "express";
import { prisma } from '../../prisma.js';

export class RoteiroController {
  // 1. Listar roteiros do Tenant (Cidade/Destino)
  async getRoutes(req: Request, res: Response) {
    try {
      const { tenantSlug } = req.params;

      const tenant = await prisma.tenant.findUnique({
        where: { slug: tenantSlug },
      });

      if (!tenant) {
        return res.status(404).json({ error: "Destino não encontrado" });
      }

      const routes = await prisma.route.findMany({
        where: { tenantId: tenant.id },
        include: {
          stops: {
            orderBy: { order: 'asc' }
          }
        },
      });

      return res.json(routes);
    } catch (error) {
      console.error("Erro ao buscar roteiros:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  // 2. IA: Gerar Roteiro Inteligente
  async generateAIAssistedRoute(req: Request, res: Response) {
    try {
      const { tenantSlug } = req.params;
      const { interests, timeAvailable, budget } = req.body;
      
      // Aqui integraria com a OpenAI ou Gemini para sugerir a ordem ideal.
      // Por enquanto, vamos mockar um comportamento inteligente buscando locais.
      
      const tenant = await prisma.tenant.findUnique({
        where: { slug: tenantSlug },
      });

      if (!tenant) return res.status(404).json({ error: "Destino não encontrado" });

      // Buscar obras, eventos e parceiros
      const works = await prisma.work.findMany({ where: { tenantId: tenant.id }, take: 3 });
      const providers = await prisma.serviceProvider.findMany({ where: { tenantId: tenant.id, active: true }, take: 2 });

      // Retorno simulado da inteligência do sistema
      const generatedRoute = {
        name: "Roteiro Inteligente Baseado no seu Perfil",
        description: `Roteiro otimizado para ${timeAvailable} minutos, focado em ${interests.join(", ")}.`,
        isAIGenerated: true,
        estimatedTime: timeAvailable,
        difficulty: "MEDIUM",
        xpReward: 150,
        stops: [
          ...works.map((w, i) => ({
            targetType: "WORK",
            targetId: w.id,
            name: w.title,
            latitude: w.latitude || 0,
            longitude: w.longitude || 0,
            order: i + 1
          })),
          ...providers.map((p, i) => ({
            targetType: "SERVICE",
            targetId: p.id,
            name: p.name,
            latitude: p.latitude || 0,
            longitude: p.longitude || 0,
            order: works.length + i + 1
          }))
        ]
      };

      return res.json(generatedRoute);
    } catch (error) {
      console.error("Erro na IA do roteiro:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  // 3. Marketplace: Listar Parceiros (Guias, Hotéis, Restaurantes)
  async getServiceProviders(req: Request, res: Response) {
    try {
      const { tenantSlug } = req.params;
      const { type } = req.query; // ex: TOUR_GUIDE, RESTAURANT

      const tenant = await prisma.tenant.findUnique({
        where: { slug: tenantSlug },
      });

      if (!tenant) return res.status(404).json({ error: "Destino não encontrado" });

      const providers = await prisma.serviceProvider.findMany({
        where: { 
          tenantId: tenant.id,
          active: true,
          verified: true, // Apenas parceiros aprovados
          ...(type ? { type: type as any } : {})
        },
      });

      return res.json(providers);
    } catch (error) {
      console.error("Erro ao buscar parceiros:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }
}
