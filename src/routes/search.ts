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

        // Buscas paralelas
        const [works, trails, events] = await Promise.all([
            prisma.work.findMany({
                where: {
                    tenantId,
                    OR: [
                        { title: { contains: term, mode: "insensitive" } },
                        { description: { contains: term, mode: "insensitive" } },
                        { artist: { contains: term, mode: "insensitive" } }
                    ]
                },
                take: 5,
                select: { id: true, title: true, description: true }
            }),
            prisma.trail.findMany({
                where: {
                    tenantId,
                    OR: [
                        { title: { contains: term, mode: "insensitive" } },
                        { description: { contains: term, mode: "insensitive" } }
                    ]
                },
                take: 5,
                select: { id: true, title: true, description: true }
            }),
            prisma.event.findMany({
                where: {
                    tenantId,
                    OR: [
                        { title: { contains: term, mode: "insensitive" } },
                        { description: { contains: term, mode: "insensitive" } },
                        { location: { contains: term, mode: "insensitive" } }
                    ]
                },
                take: 5,
                select: { id: true, title: true, description: true }
            })
        ]);

        // Formata para o padrão unificado
        const results = [
            ...works.map(w => ({
                id: w.id,
                title: w.title,
                type: "work",
                description: w.description,
                url: `/obras/${w.id}`
            })),
            ...trails.map(t => ({
                id: t.id,
                title: t.title,
                type: "trail",
                description: t.description,
                url: `/trilhas/${t.id}`
            })),
            ...events.map(e => ({
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
