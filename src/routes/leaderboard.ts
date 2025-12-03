import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

// Top visitantes por XP (Leaderboard)
router.get("/", authMiddleware, async (req, res) => {
    try {
        const userEmail = (req as any).user?.email;

        // 1. Get Top 50 Global (Aggregated by Email)
        // We use MAX(name) and MAX(photoUrl) to pick one representative name/photo for the email
        const topVisitors = await prisma.$queryRaw`
            SELECT 
                email, 
                MAX(name) as name, 
                MAX("photoUrl") as "photoUrl", 
                SUM(xp)::int as xp,
                RANK() OVER (ORDER BY SUM(xp) DESC)::int as rank
            FROM "Visitor"
            WHERE email IS NOT NULL
            GROUP BY email
            ORDER BY xp DESC
            LIMIT 50
        `;

        // 2. Get Current User Rank (if logged in)
        let myRankData = null;
        if (userEmail) {
            // Calculate my total XP
            const myStats: any[] = await prisma.$queryRaw`
                SELECT SUM(xp)::int as total_xp FROM "Visitor" WHERE email = ${userEmail}
            `;
            const myTotalXp = myStats[0]?.total_xp || 0;

            // Count how many people have more XP than me
            const rankCount: any[] = await prisma.$queryRaw`
                SELECT COUNT(*)::int as count 
                FROM (
                    SELECT email, SUM(xp) as total_xp 
                    FROM "Visitor" 
                    WHERE email IS NOT NULL 
                    GROUP BY email
                ) as grouped
                WHERE total_xp > ${myTotalXp}
            `;

            const rank = (rankCount[0]?.count || 0) + 1;

            myRankData = {
                rank: Number(rank),
                xp: Number(myTotalXp),
                name: (req as any).user.name,
                email: userEmail,
                photoUrl: (req as any).user.photoUrl
            };
        }

        // Process BigInt serialization if needed (Prisma returns BigInt for some aggregates)
        const serializedTop = (topVisitors as any[]).map(v => ({
            ...v,
            xp: Number(v.xp),
            rank: Number(v.rank)
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
