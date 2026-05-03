import { Router } from "express";
import { prisma } from "../prisma.js";

const router = Router();

router.get("/", async (req, res) => {
    try {
        const { q, tenantId } = req.query as { q?: string; tenantId?: string };

        if (!q || !tenantId) {
            return res.status(400).json({ message: "Termo de busca (q) e tenantId são obrigatórios" });
        }

        const term = q.trim();
        if (term.length < 2) {
            return res.json([]); // Retorna vazio se for muito curto
        }

        // 1. Busca QR codes que batem com o termo
        const qrCodes = await prisma.qRCode.findMany({
            where: {
                tenantId,
                code: { contains: term, mode: "insensitive" },
                type: "WORK"
            },
            select: { referenceId: true }
        });

        const workIdsFromQR = qrCodes
            .map(qr => qr.referenceId)
            .filter((id): id is string => !!id);

        // Security: Default search should only return PUBLIC and PUBLISHED items
        // unless we add auth check here. For now, enforcing public safety.
        const [works, trails, events] = await Promise.all([
            prisma.work.findMany({
                where: {
                    tenantId,
                    active: true, // Only active works
                    OR: [
                        { title: { contains: term, mode: "insensitive" } },
                        { artist: { contains: term, mode: "insensitive" } },
                        { id: { in: workIdsFromQR } }
                    ]
                },
                take: 5,
                select: { id: true, title: true, description: true }
            }),
            prisma.trail.findMany({
                where: {
                    tenantId,
                    active: true, // Only active trails
                    OR: [
                        { title: { contains: term, mode: "insensitive" } },
                    ]
                },
                take: 5,
                select: { id: true, title: true, description: true }
            }),
            prisma.event.findMany({
                where: {
                    tenantId,
                    status: 'PUBLISHED', // Only published events
                    visibility: 'PUBLIC',
                    deletedAt: null,
                    OR: [
                        { title: { contains: term, mode: "insensitive" } },
                        { location: { contains: term, mode: "insensitive" } }
                    ]
                },
                take: 5,
                select: { id: true, title: true, description: true }
            })
        ]);

        // Formata para o padrão unificado
        const results = [
            ...works.map((w: any) => ({
                id: w.id,
                title: w.title,
                type: "work",
                description: w.description,
                url: `/obras/${w.id}`
            })),
            ...trails.map((t: any) => ({
                id: t.id,
                title: t.title,
                type: "trail",
                description: t.description,
                url: `/trilhas/${t.id}`
            })),
            ...events.map((e: any) => ({
                id: e.id,
                title: e.title,
                type: "event",
                description: e.description,
                url: `/eventos/${e.id}`
            }))
        ];

        return res.json(results);
    } catch (err) {
        console.error("Erro na busca global", err);
        return res.status(500).json({ message: "Erro ao realizar busca" });
    }
});

export default router;
