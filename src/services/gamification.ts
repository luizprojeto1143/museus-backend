import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class GamificationService {
    /**
     * Retrieves the top 10 leaderboard for a tenant
     */
    static async getLeaderboard(tenantId: string) {
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

        return topVisitors.map((v, i) => ({
            rank: i + 1,
            name: v.name || `Visitante ${v.id.substring(0, 4)}`,
            xp: v.xp,
            isCurrentUser: false
        }));
    }

    /**
     * Generates dynamic clues based on published works
     */
    static async getClues(tenantId: string) {
        const works = await prisma.work.findMany({
            where: { tenantId, published: true },
            take: 3, // Generate 3 clues
            select: { id: true, title: true, artist: true, room: true }
        });

        if (works.length === 0) return [];

        return works.map((work, index) => ({
            id: `clue-${work.id}`,
            riddle: `Procure pela obra "${work.title}" de ${work.artist || "artista desconhecido"}.${work.room ? ` Ela está na ${work.room}.` : ""}`,
            targetWorkId: work.id,
            xpReward: 50 + (index * 25), // 50, 75, 100
            isActive: true
        }));
    }
}
