import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { Role } from "@prisma/client";
import { dispatchEvent, backgroundQueue } from "../../infrastructure/queue/bullmq.setup.js";

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
router.get("/nearby", authMiddleware, async (req, res) => {
  try {
    const { lat, lng, radius = 500, tenantId } = req.query;
    const user = req.user!;

    if (!lat || !lng || !tenantId) {
      return res.status(400).json({ message: "lat, lng e tenantId são obrigatórios" });
    }

    // L6 Fix: Verify tenant access (unless MASTER)
    if (user.role !== Role.MASTER && user.tenantId !== tenantId) {
       return res.status(403).json({ message: "Acesso negado a este museu" });
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

    if (!workId || !visitorId) {
      return res.status(400).json({ message: "Dados incompletos para captura" });
    }

    // 1. Verificar se a obra existe e é um vestígio ativo
    const work = await (prisma.work as any).findUnique({
      where: { id: workId },
    });

    if (!work || work.deletedAt) {
      return res.status(404).json({ message: "Vestígio não encontrado" });
    }

    // L1 Fix: Check for RELIC status even if not active
    const now = new Date();
    const isExpired = work.vestigeExpiresAt && work.vestigeExpiresAt < now;

    if (!work.vestigeActive && !isExpired) {
      return res.status(400).json({ message: "Vestígio inativo" });
    }

    // 2. GPS Proximity (Optional - bypassed for QR-only flow)
    // We still record if provided, but no longer block the user
    const distance = (work.lat && work.lng && lat && lng) ? getDistance(lat, lng, work.lat, work.lng) : null;

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
    // C2 Fix: Use atomic increment with raw SQL to prevent race condition
    const result = await prisma.$transaction(async (tx) => {
      // C2 Atomic Update
      await (tx as any).$executeRaw`UPDATE "Work" SET "vestigeTotalCapturas" = "vestigeTotalCapturas" + 1 WHERE id = ${workId}`;
      
      const updatedWork = await (tx.work as any).findUnique({
        where: { id: workId },
        select: { vestigeTotalCapturas: true, vestigeExpiresAt: true }
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

      // L1 Fix: Correct RELIC logic (capture historical)
      const now = new Date();
      if (updatedWork.vestigeExpiresAt && updatedWork.vestigeExpiresAt < now) {
        raridade = "RELIC";
        xp = 300; 
      }

      const stamp = await (tx.passportStamp as any).create({
        data: {
          visitorId,
          workId,
          raridade,
          numeroCaptura: count,
          xpGanho: xp,
          latCaptura: lat || null,
          lngCaptura: lng || null,
          accuracyMetros: accuracy || 0
        }
      });

      // Incrementar XP do visitante de forma assíncrona
      await dispatchEvent(backgroundQueue, 'AwardGamificationXP', {
        visitorId,
        xp,
        reason: 'Captura de Vestígio'
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
router.get("/passport/:visitorId", authMiddleware, async (req, res) => {
  try {
    const { visitorId } = req.params;
    const user = req.user!;

    // C1 Fix: Enforce ownership
    if (user.role !== Role.MASTER && user.id !== visitorId) {
       return res.status(403).json({ message: "Acesso negado" });
    }

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
              select: { name: true, slug: true, address: true, city: true } // I6: Include city
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
