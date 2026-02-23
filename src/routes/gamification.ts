import { Router } from "express";
import { prisma } from "../prisma.js";
import { GamificationService } from "../services/gamification.js";

const router = Router();

// Get Leaderboard (Top 10 XP)
router.get("/leaderboard", async (req, res) => {
    try {
        const { tenantId } = req.query as { tenantId?: string };

        if (!tenantId) {
            return res.status(400).json({ message: "tenantId is required" });
        }

        const leaderboard = await GamificationService.getLeaderboard(tenantId, req.user?.email);
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

        const clues = await GamificationService.getClues(tenantId);
        return res.json(clues);
    } catch (err) {
        console.error("Error fetching clues", err);
        return res.status(500).json({ message: "Error fetching clues" });
    }
});

import jwt from "jsonwebtoken";
import { authMiddleware } from "../middleware/auth.js";

const GAME_SECRET = process.env.GAME_SECRET || (() => {
    console.warn("⚠️  WARNING: GAME_SECRET not set. Using insecure default. Set GAME_SECRET in production!");
    return "dev-only-insecure-game-key";
})();

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

        // Max realistic speed: 10 points per second (assuming fast quiz answers)
        // Minimum session: 10 seconds to claim significant points
        const minDuration = 5;
        const maxScorePerSecond = 10;
        const maxGenericScore = Math.max(500, durationSeconds * maxScorePerSecond);

        if (durationSeconds < minDuration && score > 50) {
            return res.status(400).json({ message: "Muito rápido! Tente novamente com mais calma." });
        }

        if (score > maxGenericScore && score > 1000) { // Tolerance for small scores
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
