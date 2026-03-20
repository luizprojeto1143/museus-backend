import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// Haversine formula to calculate distance between two points in meters
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; // Earth radius in meters
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// GET /vestiges/nearby - Encontrar vestígios próximos ao GPS do usuário
router.get("/nearby", async (req, res) => {
  try {
    const { lat, lng, radius = 500, tenantId } = req.query;

    if (!lat || !lng || !tenantId) {
      return res.status(400).json({ message: "lat, lng e tenantId são obrigatórios" });
    }

    const uLat = parseFloat(lat as string);
    const uLng = parseFloat(lng as string);
    const uRad = parseFloat(radius as string);

    // Busca obras que tenham coordenadas e estejam ativas como vestígios
    const works = await (prisma.work as any).findMany({
      where: {
        tenantId: tenantId as string,
        lat: { not: null },
        lng: { not: null },
        vestigeActive: true,
        deletedAt: null,
      },
    });

    const nearbyVestiges = (works as any[])
      .map((w) => {
        const distance = getDistance(uLat, uLng, w.lat!, w.lng!);
        return { ...w, distance };
      })
      .filter((w) => w.distance <= uRad)
      .sort((a, b) => a.distance - b.distance);

    return res.json(nearbyVestiges);
  } catch (err) {
    console.error("Erro ao buscar vestígios próximos:", err);
    return res.status(500).json({ message: "Erro ao buscar vestígios próximos" });
  }
});

// POST /vestiges/capture - Capturar um vestígio (GPS + Rarity)
router.post("/capture", authMiddleware, async (req, res) => {
  try {
    const { workId, lat, lng, accuracy } = req.body;
    const visitorId = req.user?.id;

    if (!workId || !lat || !lng || !visitorId) {
      return res.status(400).json({ message: "Dados incompletos para captura" });
    }

    // 1. Verificar se a obra existe e é um vestígio ativo
    const work = await (prisma.work as any).findUnique({
      where: { id: workId },
    });

    if (!work || !work.vestigeActive || work.deletedAt) {
      return res.status(404).json({ message: "Vestígio não encontrado ou inativo" });
    }

    // 2. Verificar proximidade GPS (Haversine)
    if (work.lat && work.lng) {
      const distance = getDistance(lat, lng, work.lat, work.lng);
      if (distance > (work.captureRadiusM || 15)) {
        return res.status(403).json({ 
          message: "Você está muito longe para capturar este vestígio",
          distance
        });
      }
    }

    // 3. Verificar se já capturou
    const existing = await (prisma.passportStamp as any).findUnique({
      where: {
        visitorId_workId: { visitorId, workId }
      }
    });

    if (existing) {
      return res.status(400).json({ message: "Você já capturou este vestígio" });
    }

    // 4. Incrementar contador global e determinar raridade
    // Usamos transação para garantir unicidade do contador
    const result = await prisma.$transaction(async (tx) => {
      const updatedWork = await (tx.work as any).update({
        where: { id: workId },
        data: { vestigeTotalCapturas: { increment: 1 } }
      });

      const count = updatedWork.vestigeTotalCapturas;
      let raridade = "COMMON";
      let xp = 50;

      if (count <= 50) {
        raridade = "PIONEER";
        xp = 250;
      } else if (count <= 300) {
        raridade = "EPIC";
        xp = 150;
      } else if (count <= 1000) {
        raridade = "RARE";
        xp = 100;
      }

      // Se a exposição expirou/acabou de ser marcada como inativa, vira RELIC
      const now = new Date();
      if (work.vestigeExpiresAt && work.vestigeExpiresAt < now) {
        raridade = "RELIC";
        xp = 300; // Bônus por capturar algo histórico
      }

      const stamp = await (tx.passportStamp as any).create({
        data: {
          visitorId,
          workId,
          raridade,
          numeroCaptura: count,
          xpGanho: xp,
          latCaptura: lat,
          lngCaptura: lng,
          accuracyMetros: accuracy
        }
      });

      // Incrementar XP do visitante
      await tx.visitor.update({
        where: { id: visitorId },
        data: { xp: { increment: xp } }
      });

      return { stamp, raridade, xp };
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error("Erro ao capturar vestígio:", err);
    return res.status(500).json({ message: "Erro ao capturar vestígio" });
  }
});

// POST /vestiges/expire/:workId - Encerrar vestígio e converter coleções em RELIC (Admin)
router.post("/expire/:workId", authMiddleware, async (req, res) => {
  try {
    if (req.user?.role !== Role.MASTER && req.user?.role !== Role.ADMIN) {
      return res.status(403).json({ message: "Acesso negado" });
    }

    const { workId } = req.params;

    const result = await prisma.$transaction([
      // 1. Inativar vestígio na obra
      (prisma.work as any).update({
        where: { id: workId },
        data: { 
          vestigeActive: false,
          vestigeExpiresAt: new Date()
        }
      }),
      // 2. Marcar todos os carimbos existentes como RELIC
      (prisma.passportStamp as any).updateMany({
        where: { workId },
        data: { 
          isRelic: true,
          raridade: "RELIC",
          convertidoEm: new Date()
        }
      })
    ]);

    return res.json({ message: "Vestígio expirado e coleções convertidas em Relíquias", data: result });
  } catch (err) {
    console.error("Erro ao expirar vestígio:", err);
    return res.status(500).json({ message: "Erro ao expirar vestígio" });
  }
});

// GET /vestiges/passport/:visitorId - Ver passaporte consolidado
router.get("/passport/:visitorId", async (req, res) => {
  try {
    const { visitorId } = req.params;

    const stamps = await (prisma.passportStamp as any).findMany({
      where: { visitorId },
      include: {
        work: {
          select: {
            title: true,
            artist: true,
            vestigeImageUrl: true,
            imageUrl: true,
            tenant: {
              select: { name: true, slug: true, address: true }
            }
          }
        }
      },
      orderBy: { stampedAt: "desc" }
    });

    return res.json(stamps);
  } catch (err) {
    console.error("Erro ao buscar passaporte:", err);
    return res.status(500).json({ message: "Erro ao buscar passaporte" });
  }
});

export default router;
