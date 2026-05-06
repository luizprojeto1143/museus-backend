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

// NOVO: Ranking Consolidado por Cidade (Soma XP de todos os equipamentos do município)
router.get("/city/:cityId", authMiddleware, async (req: any, res: any) => {
    try {
        const { cityId } = req.params;

        // 1. Buscar todos os IDs de tenants (museus/espaços) que pertencem a esta cidade
        const childTenants = await prisma.tenant.findMany({
            where: { 
                OR: [
                    { id: cityId },
                    { parentId: cityId }
                ]
            },
            select: { id: true }
        });

        const tenantIds = childTenants.map(t => t.id);

        if (tenantIds.length === 0) {
            return res.status(404).json({ message: "Cidade não encontrada ou sem equipamentos vinculados." });
        }

        // 2. Agrupar visitantes por e-mail e somar XP de todos os equipamentos
        const aggregatedRanking = await prisma.visitor.groupBy({
            by: ['email'],
            where: {
                tenantId: { in: tenantIds }
            },
            _sum: {
                xp: true
            },
            _max: {
                name: true,
                photoUrl: true
            },
            orderBy: {
                _sum: {
                    xp: 'desc'
                }
            },
            take: 10
        });

        // 3. Formatar resposta
        const ranking = aggregatedRanking.map((item, index) => ({
            rank: index + 1,
            name: item._max.name || "Visitante Anônimo",
            photoUrl: item._max.photoUrl || "",
            xp: Number(item._sum.xp || 0),
            email: item.email
        }));

        // 4. Calcular meu rank na cidade
        const myEmail = req.user.email;
        const myTotalXpRaw = await prisma.visitor.aggregate({
            where: {
                email: myEmail,
                tenantId: { in: tenantIds }
            },
            _sum: {
                xp: true
            }
        });

        const myTotalXp = Number(myTotalXpRaw._sum.xp || 0);

        // Para o rank exato, precisaríamos de uma query mais complexa ou processamento em memória
        // Como é o Top 10, se eu estiver no ranking, já tenho o index.
        const myIndex = ranking.findIndex(r => r.email === myEmail);
        let myRank = 0;
        
        if (myIndex !== -1) {
            myRank = myIndex + 1;
        } else if (myTotalXp > 0) {
            // Se não estou no Top 10, fazemos um count aproximado
            // Nota: Agregação de rank em groupBy é pesada, usando estimativa
            const betterCount = await prisma.visitor.groupBy({
                by: ['email'],
                where: {
                    tenantId: { in: tenantIds }
                },
                _sum: {
                    xp: true
                },
                having: {
                    xp: {
                        _sum: {
                            gt: myTotalXp
                        }
                    }
                }
            });
            myRank = betterCount.length + 1;
        }

        return res.json({
            cityName: (await prisma.tenant.findUnique({ where: { id: cityId }, select: { name: true } }))?.name || "Cidade",
            ranking,
            myRank: {
                rank: myRank,
                xp: myTotalXp,
                name: req.user.name,
                photoUrl: (req.user as any).photoUrl || ""
            }
        });

    } catch (err) {
        console.error("Erro city leaderboard", err);
        return res.status(500).json({ message: "Erro ao carregar ranking da cidade" });
    }
});

export default router;
