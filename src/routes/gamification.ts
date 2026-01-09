import { Router } from "express";
import { prisma } from "../prisma.js";

const router = Router();

// Get Leaderboard (Top 10 XP)
router.get("/leaderboard", async (req, res) => {
    try {
        const { tenantId } = req.query as { tenantId?: string };

        if (!tenantId) {
            return res.status(400).json({ message: "tenantId is required" });
        }

        const topVisitors = await prisma.visitor.findMany({
            where: { tenantId },
            orderBy: { xp: 'desc' },
            take: 10,
            select: {
                id: true,
                name: true,
                xp: true
            }
        });

        // Mask names for privacy if needed, or return as is (Gamification usually public)
        const leaderboard = topVisitors.map((v, i) => ({
            rank: i + 1,
            name: v.name || `Visitante ${v.id.substring(0, 4)}`,
            xp: v.xp,
            isCurrentUser: false // Frontend fills this
        }));

        return res.json(leaderboard);
    } catch (err) {
        console.error("Error fetching leaderboard", err);
        return res.status(500).json({ message: "Error fetching leaderboard" });
    }
});

// Get treasure hunt clues
router.get("/clues", async (req, res) => {
    try {
        const { tenantId } = req.query as { tenantId?: string };

        if (!tenantId) {
            return res.status(400).json({ message: "tenantId is required" });
        }

        // Fetch random works to generate clues
        // In a real app, we would have a Clue table.
        // Here we simulate clues based on real works.
        const works = await prisma.work.findMany({
            where: { tenantId, published: true },
            take: 3, // Generate 3 clues
            select: { id: true, title: true, artist: true, room: true }
        });

        if (works.length === 0) {
            return res.json([]);
        }

        const clues = works.map((work, index) => ({
            id: `clue-${work.id}`,
            riddle: `Procure pela obra "${work.title}" de ${work.artist || "artista desconhecido"}.${work.room ? ` Ela está na ${work.room}.` : ""}`,
            targetWorkId: work.id, // In a real hunt, this might be obscured
            xpReward: 50 + (index * 25), // 50, 75, 100
            isActive: true
        }));

        return res.json(clues);
    } catch (err) {
        console.error("Error fetching clues", err);
        return res.status(500).json({ message: "Error fetching clues" });
    }
});

export default router;
