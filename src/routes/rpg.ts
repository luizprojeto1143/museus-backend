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

// GET /rpg/me — Get visitor's RPG profiles
router.get('/me', authMiddleware, async (req, res) => {
    try {
        if (!req.user?.email || !req.user?.tenantId) {
            return res.status(401).json({ message: 'Autenticação inválida no token' });
        }

        const userEmail = req.user.email.toLowerCase();
        const tenantId = req.user.tenantId;
        console.log(`[RPG] Fetching profile for ${userEmail} in tenant ${tenantId}`);

        const visitor = await prisma.visitor.findFirst({ 
            where: { email: userEmail, tenantId },
            select: { id: true, xp: true, level: true }
        });

        if (!visitor) {
            console.warn(`[RPG] Visitor not found for ${userEmail} in tenant ${tenantId}`);
            return res.status(404).json({ message: 'Visitante não encontrado neste museu' });
        }

        const visitorId = visitor.id;

        // Get all characters for this visitor
        const characters = await prisma.visitorRPG.findMany({
            where: { visitorId },
            include: { 
                selectedCharacter: true,
                equippedSkin: true
            }
        });

        // Sync real stats (XP comes from Visitor model)
        let totalXp = Number(visitor.xp) || 0;
        let currentXp = totalXp;
        let newLevel = 1;
        let nextLevelXp = 100;

        // Safety limit to avoid infinite loops if config is broken
        let iterations = 0;
        while (currentXp >= nextLevelXp && iterations < 1000) {
            currentXp -= nextLevelXp;
            newLevel += 1;
            nextLevelXp = Math.floor(nextLevelXp * 1.3) || 100; // avoid 0
            iterations++;
        }

        let newClass = 'NOVATO';
        for (const threshold of classThresholds) {
            if (newLevel >= threshold.level) newClass = threshold.name;
        }

        // Return all characters + current visitor stats
        res.json({
            visitor: {
                id: visitorId,
                xp: totalXp,
                level: newLevel,
                nextLevelXp,
                currentXp,
                class: newClass
            },
            characters: characters.map(c => ({
                ...c,
                level: newLevel,
                characterClass: newClass
            }))
        });
    } catch (error) {
        console.error("[RPG] Error in /me:", error);
        res.status(500).json({ message: 'Erro ao buscar RPG', error: error instanceof Error ? error.message : "Erro desconhecido" });
    }
});

router.post('/add-xp', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user!.email.toLowerCase();
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const visitor = await prisma.visitor.findFirst({ where: { email: userEmail, tenantId } });
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado neste museu' });
        const visitorId = visitor.id;

        const { xp } = req.body;
        const amount = parseInt(xp) || 0;
        if (amount <= 0) return res.status(400).json({ message: 'XP inválido' });

        let rpg = await prisma.visitorRPG.findFirst({ where: { visitorId, isActive: true } });
        if (!rpg) {
            rpg = await prisma.visitorRPG.create({
                data: { visitorId, characterName: 'Explorador', characterClass: 'NOVATO', level: 1, currentXp: 0, nextLevelXp: 100, isActive: true }
            });
        }

        let newLevel = rpg.level;
        let newXp = (rpg.currentXp || 0) + amount;
        let nextLevelXp = rpg.nextLevelXp;
        let leveledUp = false;

        while (newXp >= nextLevelXp) {
            newXp -= nextLevelXp;
            newLevel += 1;
            nextLevelXp = Math.floor(nextLevelXp * 1.3);
            leveledUp = true;
        }

        let newClass = rpg.characterClass;
        for (const threshold of classThresholds) {
            if (newLevel >= threshold.level) newClass = threshold.name;
        }

        await prisma.visitorRPG.updateMany({
            where: { visitorId },
            data: { currentXp: newXp, level: newLevel, nextLevelXp, characterClass: newClass }
        });

        const updated = await prisma.visitorRPG.findFirst({
            where: { visitorId, isActive: true },
            include: { selectedCharacter: true }
        });

        res.json({ ...updated, leveledUp, xpAdded: amount });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao adicionar XP' });
    }
});

router.put('/customize', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user!.email.toLowerCase();
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const visitor = await prisma.visitor.findFirst({ where: { email: userEmail, tenantId } });
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado neste museu' });
        const visitorId = visitor.id;

        const { characterName, avatarUrl } = req.body;
        await prisma.visitorRPG.updateMany({
            where: { visitorId, isActive: true },
            data: { ...(characterName && { characterName }), ...(avatarUrl && { avatarUrl }) }
        });
        const updated = await prisma.visitorRPG.findFirst({
            where: { visitorId, isActive: true }
        });
        res.json(updated);
    } catch (error: any) {
        console.error('[RPG] Customize error:', error);
        res.status(500).json({ message: 'Erro ao customizar', error: error.message });
    }
});

// POST /rpg/select-character — Choose a character
router.post('/select-character', authMiddleware, async (req, res) => {
    try {
        const { characterId } = req.body;
        const userEmail = req.user!.email.toLowerCase();
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });

        const visitor = await prisma.visitor.findFirst({ where: { email: userEmail, tenantId: tenantId } });
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado' });
        const visitorId = visitor.id;

        // Try to find if already exists
        const existing = await prisma.visitorRPG.findUnique({
            where: { visitorId_selectedCharacterId: { visitorId, selectedCharacterId: characterId } }
        });

        if (existing) {
            await prisma.visitorRPG.updateMany({
                where: { visitorId },
                data: { isActive: false }
            });
            const updated = await prisma.visitorRPG.update({
                where: { id: existing.id },
                data: { isActive: true }
            });
            return res.json(updated);
        }

        // Create new character progress
        await prisma.visitorRPG.updateMany({
            where: { visitorId },
            data: { isActive: false }
        });

        const updated = await prisma.visitorRPG.create({
            data: { 
                visitorId, 
                selectedCharacterId: characterId,
                isActive: true,
                characterName: (await prisma.characterBase.findUnique({ where: { id: characterId } }))?.name || 'Explorador'
            },
            include: { selectedCharacter: true }
        });

        res.json(updated);
    } catch (error: any) {
        console.error('[RPG] Select character error:', error);
        res.status(500).json({ message: 'Erro ao selecionar personagem', error: error.message });
    }
});

// PUT /rpg/equip-skin — Equip a skin for a specific character
router.put('/equip-skin', authMiddleware, async (req, res) => {
    try {
        const { characterId, skinId } = req.body;
        const userEmail = req.user!.email.toLowerCase();
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });

        const visitor = await prisma.visitor.findFirst({ where: { email: userEmail, tenantId: tenantId } });
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado' });

        // 1. Verify ownership
        const ownership = await prisma.visitorSkin.findUnique({
            where: { visitorId_skinId: { visitorId: visitor.id, skinId } },
            include: { skin: true }
        });
        if (!ownership) return res.status(403).json({ message: 'Você não possui esta skin' });

        // 2. Verify skin compatibility with character
        if (ownership.skin.characterBaseId && ownership.skin.characterBaseId !== characterId) {
            return res.status(400).json({ message: 'Esta skin não serve para este personagem' });
        }

        // 3. Equip
        const updatedRPG = await prisma.visitorRPG.update({
            where: { visitorId_selectedCharacterId: { visitorId: visitor.id, selectedCharacterId: characterId } },
            data: { equippedSkinId: skinId },
            include: { equippedSkin: true }
        });

        res.json(updatedRPG);
    } catch (error: any) {
        console.error('[RPG] Equip skin error:', error);
        res.status(500).json({ message: 'Erro ao equipar skin', error: error.message });
    }
});

export default router;
