import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

const classThresholds = [
    { level: 1, xp: 0, name: 'NOVATO' },
    { level: 5, xp: 500, name: 'APRENDIZ' },
    { level: 10, xp: 2000, name: 'MESTRE' },
    { level: 20, xp: 5000, name: 'LENDA' }
];

// GET /rpg/me — Get visitor's RPG profile
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user!.email;
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const visitor = await prisma.visitor.findFirst({ where: { email: userEmail, tenantId } });
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado neste museu' });
        const visitorId = visitor.id;

        let rpg = await prisma.visitorRPG.findUnique({ where: { visitorId } });

        // Sync real stats
        const [totalVisits, totalWorks] = await Promise.all([
            prisma.visitorVisit.count({ where: { visitorId } }),
            prisma.visitorVisit.count({ where: { visitorId, workId: { not: null } } })
        ]);

        let currentXp = visitor.xp;
        let newLevel = 1;
        let nextLevelXp = 100;

        while (currentXp >= nextLevelXp) {
            currentXp -= nextLevelXp;
            newLevel += 1;
            nextLevelXp = Math.floor(nextLevelXp * 1.3);
        }

        let newClass = 'NOVATO';
        for (const threshold of classThresholds) {
            if (newLevel >= threshold.level) newClass = threshold.name;
        }

        if (!rpg) {
            rpg = await prisma.visitorRPG.create({
                data: { visitorId, characterName: req.user!.name || 'Explorador', characterClass: newClass, level: newLevel, currentXp, nextLevelXp, totalVisits, totalWorks }
            });
        } else {
            rpg = await prisma.visitorRPG.update({
                where: { visitorId },
                data: { characterClass: newClass, level: newLevel, currentXp, nextLevelXp, totalVisits, totalWorks }
            });
        }

        res.json(rpg);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar RPG' });
    }
});

router.post('/add-xp', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user!.email;
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const visitor = await prisma.visitor.findFirst({ where: { email: userEmail, tenantId } });
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado neste museu' });
        const visitorId = visitor.id;

        const { xp, source } = req.body;
        const amount = parseInt(xp) || 0;
        if (amount <= 0) return res.status(400).json({ message: 'XP inválido' });

        let rpg = await prisma.visitorRPG.findUnique({ where: { visitorId } });
        if (!rpg) {
            rpg = await prisma.visitorRPG.create({
                data: { visitorId, characterName: 'Explorador', characterClass: 'NOVATO', level: 1, currentXp: 0, nextLevelXp: 100 }
            });
        }

        let newXp = rpg.currentXp + amount;
        let newLevel = rpg.level;
        let nextLevelXp = rpg.nextLevelXp;
        let leveledUp = false;

        // Level up loop
        while (newXp >= nextLevelXp) {
            newXp -= nextLevelXp;
            newLevel += 1;
            nextLevelXp = Math.floor(nextLevelXp * 1.3);
            leveledUp = true;
        }

        // Update class based on level
        let newClass = rpg.characterClass;
        for (const threshold of classThresholds) {
            if (newLevel >= threshold.level) newClass = threshold.name;
        }

        const updated = await prisma.visitorRPG.update({
            where: { visitorId },
            data: { currentXp: newXp, level: newLevel, nextLevelXp, characterClass: newClass }
        });

        res.json({ ...updated, leveledUp, xpAdded: amount });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao adicionar XP' });
    }
});

router.put('/customize', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user!.email;
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const visitor = await prisma.visitor.findFirst({ where: { email: userEmail, tenantId } });
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado neste museu' });
        const visitorId = visitor.id;

        const { characterName, avatarUrl } = req.body;
        const rpg = await prisma.visitorRPG.update({
            where: { visitorId },
            data: { ...(characterName && { characterName }), ...(avatarUrl && { avatarUrl }) }
        });
        res.json(rpg);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro' });
    }
});

export default router;
