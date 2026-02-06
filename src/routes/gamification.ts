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

import jwt from "jsonwebtoken";
import { authMiddleware } from "../middleware/auth.js";

const GAME_SECRET = process.env.GAME_SECRET || "super-secret-game-key";

// 3. Start Game Session (Anti-Cheat handshake)
router.post("/session/start", authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        // Return a signed session token
        const gameToken = jwt.sign({
            userId: user.id,
            startTime: Date.now(),
            valid: true
        }, GAME_SECRET, { expiresIn: '1h' });

        return res.json({ gameToken });
    } catch (err) {
        return res.status(500).json({ message: "Error starting game session" });
    }
});

// 4. End Game Session (Validate & Save)
router.post("/session/end", authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const { gameToken, score, coins } = req.body;

        if (!gameToken || score === undefined) {
            return res.status(400).json({ message: "Dados incompletos" });
        }

        // Verify Token
        let decoded;
        try {
            decoded = jwt.verify(gameToken, GAME_SECRET) as { startTime: number, userId: string };
        } catch (e) {
            return res.status(403).json({ message: "Sessão de jogo inválida ou expirada." });
        }

        if (decoded.userId !== user.id) {
            return res.status(403).json({ message: "Token não pertence ao usuário." });
        }

        // ANTI-CHEAT LOGIC 🛡️
        const durationSeconds = (Date.now() - decoded.startTime) / 1000;
        const maxGenericScore = Math.max(5000, durationSeconds * 200);

        if (score > maxGenericScore && score > 2000) {
            console.warn(`CHEAT DETECTED: User ${user.id} claimed ${score} in ${durationSeconds}s`);
            return res.status(400).json({ message: "Pontuação inconsistente com o tempo de jogo." });
        }

        // GPS Validation (New)
        // If query param 'lat' and 'lng' are sent, verify distance to Museum
        // For MVP, we just log it, but here is the logic:
        // const { lat, lng } = req.body;
        // if (lat && lng) {
        //    const distance = calculateDistance(lat, lng, museumLat, museumLng);
        //    if (distance > 0.5) { // 500m radius
        //       return res.status(400).json({ message: "Você precisa estar no museu para validar os pontos!" });
        //    }
        // }

        // If valid, find visitor and award XP
        const visitor = await prisma.visitor.findFirst({
            where: {
                email: user.email,
                tenantId: user.tenantId ?? undefined
            }
        });

        if (visitor) {
            // Cap daily XP (e.g., max 1000 XP per day) - Advanced feature for later
            await prisma.visitor.update({
                where: { id: visitor.id },
                data: { xp: { increment: Math.floor(score * 0.1) } }
            });
        }

        return res.json({
            message: "Progresso salvo!",
            xpGained: Math.floor(score * 0.1),
            verified: true
        });
    } catch (err) {
        console.error("Error saving game", err);
        return res.status(500).json({ message: "Erro ao salvar progresso" });
    }
});

export default router;
