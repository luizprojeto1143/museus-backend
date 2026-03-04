import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

// Top visitantes por XP (Leaderboard)
// ...

router.get("/", authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        const userEmail = user?.email;

        // 1. Determine Context (Tenant)
        // If ?tenantId is provided (switching context), use it. Otherwise use user's home tenant.
        const tenantId = (req.query.tenantId as string) || user?.tenantId;

        if (!user) {
            return res.status(401).json({ message: "Não autenticado" });
        }

        if (!tenantId) {
            return res.status(400).json({ message: "Tenant não identificado." });
        }

        // Fetch top visitors for the TARGET tenant
        const topVisitors = await prisma.visitor.findMany({
            where: { tenantId: tenantId },
            orderBy: { xp: 'desc' },
            take: 10,
            select: {
                id: true,
                name: true,
                photoUrl: true,
                xp: true
            }
        });

        // Calculate my rank in the TARGET tenant
        // We need to find the visitor profile for this specific tenant based on email
        const myVisitor = await prisma.visitor.findFirst({
            where: {
                email: user.email,
                tenantId: tenantId
            }
        });

        let myTotalXp = 0;
        let rank = 0;

        if (myVisitor) {
            myTotalXp = Number(myVisitor.xp);
            const countBetter = await prisma.visitor.count({
                where: {
                    tenantId: tenantId,
                    xp: { gt: myTotalXp }
                }
            });
            rank = countBetter + 1;
        }

        const myRankData = {
            rank,
            xp: myTotalXp,
            name: user.name,
            email: userEmail,
            photoUrl: (user as any).photoUrl || "" // Keep empty if not present
        };

        const serializedTop = topVisitors.map((v, index) => ({
            ...v,
            xp: Number(v.xp),
            rank: index + 1
        }));

        return res.json({
            ranking: serializedTop,
            myRank: myRankData
        });
    } catch (err) {
        console.error("Erro leaderboard", err);
        return res.status(500).json({ message: "Erro ao carregar leaderboard" });
    }
});

export default router;
