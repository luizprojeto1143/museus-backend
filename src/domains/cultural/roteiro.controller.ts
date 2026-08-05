import { Request, Response } from "express";
import { prisma } from '../../prisma.js';
import { ServiceProviderType } from "@prisma/client";

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
          routeStops: {
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

  // 2. IA / Proximidade Geográfica: Gerar Roteiro Inteligente
  async generateAIAssistedRoute(req: Request, res: Response) {
    try {
      const { tenantSlug } = req.params;
      const { interests, timeAvailable, budget, userLatitude, userLongitude } = req.body;
      
      const tenant = await prisma.tenant.findUnique({
        where: { slug: tenantSlug },
      });

      if (!tenant) return res.status(404).json({ error: "Destino não encontrado" });

      // Busca dados reais (filtrando ou pontuando baseado em proximidade se GPS for fornecido)
      const works = await prisma.work.findMany({ where: { tenantId: tenant.id } });
      const providers = await prisma.serviceProvider.findMany({ where: { tenantId: tenant.id, active: true } });

      const combinedPoints = [
        ...works.map(w => ({ type: 'WORK', data: w })),
        ...providers.map(p => ({ type: 'SERVICE', data: p }))
      ];

      // Se o usuário passou GPS, calculamos a distância real (fórmula de Haversine simplificada)
      if (userLatitude && userLongitude) {
        const toRad = (value: number) => (value * Math.PI) / 180;
        
        combinedPoints.forEach(point => {
          const lat2 = point.data.latitude || 0;
          const lon2 = point.data.longitude || 0;
          
          if (lat2 !== 0 && lon2 !== 0) {
            const R = 6371; // km
            const dLat = toRad(lat2 - Number(userLatitude));
            const dLon = toRad(lon2 - Number(userLongitude));
            const lat1 = toRad(Number(userLatitude));
            const l2 = toRad(lat2);
            
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(l2); 
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
            const d = R * c;
            (point as any).distance = d;
          } else {
            (point as any).distance = 9999; // Sem GPS vai pro final
          }
        });

        // Ordenar pela distância real
        combinedPoints.sort((a: any, b: any) => a.distance - b.distance);
      }

      // Filtra e limita a quantidade baseada no tempo disponível (ex: 30 mins = 1 parada)
      const stopCount = timeAvailable ? Math.max(1, Math.floor(timeAvailable / 45)) : 5;
      const finalStops = combinedPoints.slice(0, stopCount);

      const generatedRoute = {
        name: "Roteiro Inteligente por Proximidade",
        description: `Roteiro otimizado para ${timeAvailable} minutos, sugerindo os locais mais próximos de você.`,
        isAIGenerated: true,
        estimatedTime: timeAvailable || 120,
        difficulty: "EASY",
        xpReward: 150,
        stops: finalStops.map((stop, i) => ({
          targetType: stop.type,
          targetId: stop.data.id,
          name: stop.type === 'WORK' ? (stop.data as any).title : (stop.data as any).name,
          latitude: stop.data.latitude || 0,
          longitude: stop.data.longitude || 0,
          order: i + 1,
          distanceKm: (stop as any).distance ? Number((stop as any).distance.toFixed(2)) : null
        }))
      };

      return res.json(generatedRoute);
    } catch (error) {
      console.error("Erro na busca de roteiro por GPS:", error);
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

  async getServiceProvidersAdmin(req: Request, res: Response) {
    try {
      const { tenantSlug } = req.params;
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (!tenant) return res.status(404).json({ error: "Destino nao encontrado" });

      const providers = await prisma.serviceProvider.findMany({
        where: { tenantId: tenant.id },
        orderBy: { name: "asc" },
        include: {
          providerProducts: true,
          providerReviews: true,
        },
      });

      return res.json(providers);
    } catch (error) {
      console.error("Erro ao buscar parceiros admin:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async getServiceProviderAdmin(req: Request, res: Response) {
    try {
      const { tenantSlug, id } = req.params;
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (!tenant) return res.status(404).json({ error: "Destino nao encontrado" });

      const provider = await prisma.serviceProvider.findFirst({
        where: { id, tenantId: tenant.id },
        include: {
          providerProducts: true,
          providerReviews: true,
        },
      });

      if (!provider) return res.status(404).json({ error: "Parceiro nao encontrado" });
      return res.json(provider);
    } catch (error) {
      console.error("Erro ao buscar parceiro admin:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async createServiceProvider(req: Request, res: Response) {
    try {
      const { tenantSlug } = req.params;
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (!tenant) return res.status(404).json({ error: "Destino nao encontrado" });

      const provider = await prisma.serviceProvider.create({
        data: {
          tenantId: tenant.id,
          type: (req.body.type || ServiceProviderType.TOUR_GUIDE) as ServiceProviderType,
          name: req.body.name,
          description: req.body.description || null,
          phone: req.body.phone || null,
          email: req.body.email || null,
          website: req.body.website || null,
          address: req.body.address || null,
          latitude: req.body.latitude !== undefined ? Number(req.body.latitude) : null,
          longitude: req.body.longitude !== undefined ? Number(req.body.longitude) : null,
          feePercentage: req.body.feePercentage !== undefined ? Number(req.body.feePercentage) : 10,
          active: req.body.active ?? true,
          verified: req.body.verified ?? false,
          coverUrl: req.body.coverUrl || null,
          galleryUrls: Array.isArray(req.body.galleryUrls) ? req.body.galleryUrls : [],
        },
      });

      return res.status(201).json(provider);
    } catch (error) {
      console.error("Erro ao criar parceiro:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async updateServiceProvider(req: Request, res: Response) {
    try {
      const { tenantSlug, id } = req.params;
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (!tenant) return res.status(404).json({ error: "Destino nao encontrado" });

      const existing = await prisma.serviceProvider.findFirst({ where: { id, tenantId: tenant.id } });
      if (!existing) return res.status(404).json({ error: "Parceiro nao encontrado" });

      const provider = await prisma.serviceProvider.update({
        where: { id },
        data: {
          ...(req.body.type !== undefined ? { type: req.body.type as ServiceProviderType } : {}),
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.description !== undefined ? { description: req.body.description || null } : {}),
          ...(req.body.phone !== undefined ? { phone: req.body.phone || null } : {}),
          ...(req.body.email !== undefined ? { email: req.body.email || null } : {}),
          ...(req.body.website !== undefined ? { website: req.body.website || null } : {}),
          ...(req.body.address !== undefined ? { address: req.body.address || null } : {}),
          ...(req.body.latitude !== undefined ? { latitude: Number(req.body.latitude) } : {}),
          ...(req.body.longitude !== undefined ? { longitude: Number(req.body.longitude) } : {}),
          ...(req.body.feePercentage !== undefined ? { feePercentage: Number(req.body.feePercentage) } : {}),
          ...(req.body.active !== undefined ? { active: Boolean(req.body.active) } : {}),
          ...(req.body.verified !== undefined ? { verified: Boolean(req.body.verified) } : {}),
          ...(req.body.coverUrl !== undefined ? { coverUrl: req.body.coverUrl || null } : {}),
          ...(Array.isArray(req.body.galleryUrls) ? { galleryUrls: req.body.galleryUrls } : {}),
        },
      });

      return res.json(provider);
    } catch (error) {
      console.error("Erro ao atualizar parceiro:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async deleteServiceProvider(req: Request, res: Response) {
    try {
      const { tenantSlug, id } = req.params;
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (!tenant) return res.status(404).json({ error: "Destino nao encontrado" });

      const existing = await prisma.serviceProvider.findFirst({ where: { id, tenantId: tenant.id } });
      if (!existing) return res.status(404).json({ error: "Parceiro nao encontrado" });

      await prisma.serviceProvider.delete({ where: { id } });
      return res.status(204).send();
    } catch (error) {
      console.error("Erro ao excluir parceiro:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }
}
