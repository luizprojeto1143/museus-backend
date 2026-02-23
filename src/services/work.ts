import { prisma } from "../prisma.js";

export class WorkService {
    /**
     * Finds related works based on artist and category,
     * prioritizing works not yet visited by the user.
     */
    static async getRelatedWorks(
        workId: string,
        tenantId?: string,
        visitorEmail?: string
    ) {
        const limit = 4;

        // 1. Fetch source work
        const sourceWork = await prisma.work.findUnique({
            where: { id: workId }
        });

        if (!sourceWork) {
            throw new Error("Obra não encontrada");
        }

        // 2. Identify visited works (if visitor context exists)
        let visitedWorkIds: string[] = [];
        if (visitorEmail && tenantId) {
            const visitor = await prisma.visitor.findUnique({
                where: {
                    email_tenantId: {
                        email: String(visitorEmail),
                        tenantId: String(tenantId)
                    }
                }
            });
            if (visitor) {
                const visits = await prisma.visitorVisit.findMany({
                    where: { visitorId: visitor.id, workId: { not: null } },
                    select: { workId: true }
                });
                visitedWorkIds = visits.map(v => v.workId!);
            }
        }

        // 3. Find candidates
        const conditions: any[] = [];
        if (sourceWork.artist && sourceWork.artist !== "Artista desconhecido") {
            conditions.push({ artist: sourceWork.artist });
        }
        if (sourceWork.categoryId) {
            conditions.push({ categoryId: sourceWork.categoryId });
        }

        if (conditions.length === 0) {
            return [];
        }

        const relatedCandidates = await prisma.work.findMany({
            where: {
                tenantId: sourceWork.tenantId,
                id: { not: workId },
                OR: conditions.length > 0 ? conditions : undefined,
                published: true
            },
            take: 20
        });

        // 4. Score and Sort
        const sorted = relatedCandidates.sort((a, b) => {
            let scoreA = 0;
            let scoreB = 0;

            const aVisited = visitedWorkIds.includes(a.id);
            const bVisited = visitedWorkIds.includes(b.id);

            if (!aVisited) scoreA += 100;
            if (!bVisited) scoreB += 100;

            if (a.artist === sourceWork.artist) scoreA += 10;
            if (b.artist === sourceWork.artist) scoreB += 10;

            if (a.categoryId === sourceWork.categoryId) scoreA += 5;
            if (b.categoryId === sourceWork.categoryId) scoreB += 5;

            return scoreB - scoreA;
        });

        return sorted.slice(0, limit);
    }
}
