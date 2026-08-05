import { prisma } from "../prisma.js";

export class GamificationService {
    /**
     * Retrieves the top 10 leaderboard for a tenant
     */
    static async getLeaderboard(tenantId: string, currentUserEmail?: string) {
        const topVisitors = await prisma.visitor.findMany({
            where: { tenantId },
            orderBy: { xp: 'desc' },
            take: 10,
            select: {
                id: true,
                name: true,
                xp: true,
                email: true
            }
        });

        return topVisitors.map((v, i) => ({
            rank: i + 1,
            name: v.name || `Visitante ${v.id.substring(0, 4)}`,
            xp: v.xp,
            isCurrentUser: v.email === currentUserEmail
        }));
    }

    /**
     * Generates dynamic clues based on published works
     */
    /**
     * Retrieves valid clues for a tenant
     * Uses the real 'Clue' table managed by Admins
     */
    static async getClues(tenantId: string) {
        const clues = await prisma.clue.findMany({
            where: {
                tenantId,
                active: true
            },
            orderBy: { order: 'asc' },
            include: {
                work: {
                    select: { id: true, title: true, room: true, imageUrl: true }
                }
            }
        });

        if (clues.length === 0) return [];

        return clues.map((clue) => ({
            id: clue.id,
            riddle: clue.riddle,
            // SECURITY: Do NOT send 'answer' to the frontend to prevent simple inspection cheats
            targetWorkId: clue.workId,
            xpReward: 100, // Standardize XP reward or make it dynamic if schema supported it
            date: clue.createdAt,
            // Hint: If work has a room, maybe use it as a hint?
            hint: clue.work?.room ? `Local: ${clue.work.room}` : undefined,
            isActive: true // Backward compatibility
        }));
    }
}


