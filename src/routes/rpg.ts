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
        const visitorId = req.user!.id;
        let rpg = await prisma.visitorRPG.findUnique({ where: { visitorId } });

        if (!rpg) {
            rpg = await prisma.visitorRPG.create({
                data: { visitorId, characterName: 'Explorador', characterClass: 'NOVATO', level: 1, currentXp: 0, nextLevelXp: 100 }
            });
        }

        res.json(rpg);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar RPG' });
    }
});

// POST /rpg/add-xp — Add XP and level up
router.post('/add-xp', authMiddleware, async (req, res) => {
    try {
        const visitorId = req.user!.id;
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

// PUT /rpg/customize — Update character name/avatar
router.put('/customize', authMiddleware, async (req, res) => {
    try {
        const visitorId = req.user!.id;
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
