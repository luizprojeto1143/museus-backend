import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

// Top visitantes por XP (Leaderboard)
// Extend Express Request to include user (or import from a definition file if exists)
interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        email: string;
        name: string;
        tenantId: string;
        photoUrl?: string;
    };
}

// ...

router.get("/", authMiddleware, async (req, res) => {
    try {
        const user = (req as unknown as AuthenticatedRequest).user;
        const userEmail = user?.email;

        // ...

        if (!user) {
            return res.status(401).json({ message: "Não autenticado" });
        }

        // Fetch top visitors
        const topVisitors = await prisma.visitor.findMany({
            where: { tenantId: user.tenantId },
            orderBy: { xp: 'desc' },
            take: 10,
            select: {
                id: true,
                name: true,
                photoUrl: true,
                xp: true
            }
        });

        // Calculate my rank
        const myVisitor = await prisma.visitor.findUnique({
            where: { id: user.id }
        });

        let myTotalXp = 0;
        let rank = 0;

        if (myVisitor) {
            myTotalXp = Number(myVisitor.xp);
            const countBetter = await prisma.visitor.count({
                where: {
                    tenantId: user.tenantId,
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
            photoUrl: user.photoUrl
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
