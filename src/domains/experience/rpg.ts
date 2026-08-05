import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { Role, AuditAction } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { generateCartoonAvatar, applySkinToAvatar, saveBase64ToR2 } from '../../services/avatarAI.js';

const router = Router();

const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 }, // Limit to 5MB
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/png', 'image/jpg'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Mime type não suportado. Envie apenas JPG, JPEG ou PNG.'));
        }
    }
});

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
            select: { id: true, xp: true }
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
                characterBase: true,
                skin: true
            }
        });

        // Sync real stats (XP comes from Visitor model)
        const totalXp = Number(visitor.xp) || 0;
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
        const formattedCharacters = await Promise.all(characters.map(async c => {
            // Lógica de qual imagem usar como avatar principal:
            // 1. Avatar IA com skin equipada (se gerado e cacheado)
            // 2. Avatar IA base (se gerado)
            // 3. Skin genérica equipada
            // 4. Personagem base selecionado
            // 5. /default_avatar.png

            let displayAvatarUrl = '/default_avatar.png';
            
            if (c.avatarStatus === 'READY') {
                // Tenta achar skin cacheada
                if (c.equippedSkinId) {
                    const cache = await prisma.visitorAvatarCache.findUnique({
                        where: { visitorId_cacheKey: { visitorId, cacheKey: `SKIN:${c.equippedSkinId}` } }
                    });
                    if (cache?.status === 'READY') {
                        displayAvatarUrl = cache.imageUrl;
                    } else {
                        displayAvatarUrl = c.baseAvatarUrl || c.skin?.imageUrl || c.characterBase?.imageUrl || displayAvatarUrl;
                    }
                } else {
                    displayAvatarUrl = c.baseAvatarUrl || c.characterBase?.imageUrl || displayAvatarUrl;
                }
            } else {
                displayAvatarUrl = c.skin?.imageUrl || c.characterBase?.imageUrl || displayAvatarUrl;
            }

            return {
                ...c,
                level: newLevel,
                characterClass: newClass,
                displayAvatarUrl,
                baseCharacter: c.characterBase,
                equippedSkin: c.skin
            };
        }));

        res.json({
            visitor: {
                id: visitorId,
                xp: totalXp,
                level: newLevel,
                nextLevelXp,
                currentXp,
                class: newClass
            },
            characters: formattedCharacters
        });
    } catch (error) {
        console.error("[RPG] Error in /me:", error);
        res.status(500).json({ message: 'Erro ao buscar RPG', error: error instanceof Error ? error.message : "Erro desconhecido" });
    }
});

// POST /admin/visitors/:id/grant-xp — Admin/Master only can grant XP manually
router.post('/admin/visitors/:id/grant-xp', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const { xp, reason } = req.body;

        const amount = parseInt(xp) || 0;
        if (amount <= 0) return res.status(400).json({ message: 'XP de concessão precisa ser maior que zero' });
        if (!reason || reason.trim().length < 5) {
            return res.status(400).json({ message: 'Justificativa de concessão (mínimo 5 caracteres) é obrigatória' });
        }

        const visitor = await prisma.visitor.findUnique({
            where: { id }
        });

        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado' });

        // Admin can only update visitor within same tenant
        if (req.user!.role === Role.ADMIN && visitor.tenantId !== req.user!.tenantId) {
            return res.status(403).json({ message: 'Acesso negado: visitante pertence a outro município/museu' });
        }

        const activeRPG = await prisma.visitorRPG.findFirst({
            where: { visitorId: id, isActive: true }
        });

        // Atomic update and sync
        const updatedVisitor = await prisma.$transaction(async (tx) => {
            const v = await tx.visitor.update({
                where: { id },
                data: { xp: { increment: amount } }
            });

            let nextLevelXp = 100;
            let currentXp = v.xp;
            let newLevel = 1;
            let iterations = 0;
            while (currentXp >= nextLevelXp && iterations < 1000) {
                currentXp -= nextLevelXp;
                newLevel += 1;
                nextLevelXp = Math.floor(nextLevelXp * 1.3) || 100;
                iterations++;
            }

            let newClass = 'NOVATO';
            for (const threshold of classThresholds) {
                if (newLevel >= threshold.level) newClass = threshold.name;
            }

            if (activeRPG) {
                await tx.visitorRPG.update({
                    where: { id: activeRPG.id },
                    data: {
                        currentXp,
                        level: newLevel,
                        nextLevelXp,
                        characterClass: newClass
                    }
                });
            }

            // Create historic record
            await tx.xpTransaction.create({
                data: {
                    visitorId: id,
                    type: 'ADMIN_GRANT',
                    amount,
                    balanceAfter: v.xp,
                    reason,
                    createdById: req.user!.id
                }
            });

            // Create AuditLog
            await tx.auditLog.create({
                data: {
                    tenantId: visitor.tenantId,
                    userId: req.user!.id,
                    action: AuditAction.OTHER,
                    entityType: 'Visitor',
                    entityId: id,
                    metadata: {
                        grantedXp: amount,
                        reason,
                        balanceBefore: visitor.xp,
                        balanceAfter: v.xp
                    }
                }
            });

            return v;
        });

        res.json({ success: true, newXp: updatedVisitor.xp });
    } catch (error: any) {
        console.error("[RPG] Admin Grant XP error:", error);
        res.status(500).json({ message: 'Erro ao conceder XP', error: error.message });
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

        const { characterName } = req.body; // Ignorar avatarUrl enviado pelo usuário
        await prisma.visitorRPG.updateMany({
            where: { visitorId, isActive: true },
            data: { ...(characterName && { characterName }) }
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
            include: { characterBase: true }
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

        // C3 Fix: Verify that characterId belongs to the visitor
        const rpg = await prisma.visitorRPG.findFirst({
            where: { 
                id: characterId,
                visitorId: visitor.id
            }
        });

        if (!rpg) return res.status(404).json({ message: 'Personagem não encontrado ou não pertence a você' });

        if (!skinId) {
            const updatedRPG = await prisma.visitorRPG.update({
                where: { id: rpg.id },
                data: { equippedSkinId: null },
                include: { skin: true }
            });
            return res.json(updatedRPG);
        }

        // 1. Verify skin ownership
        const ownership = await prisma.visitorSkin.findUnique({
            where: { visitorId_skinId: { visitorId: visitor.id, skinId } },
            include: { skin: true }
        });
        if (!ownership) return res.status(403).json({ message: 'Você não possui esta skin' });

        // 2. Verify skin compatibility with character
        if (ownership.skin.compatibleCharacterBaseId && ownership.skin.compatibleCharacterBaseId !== rpg.selectedCharacterId) {
            return res.status(400).json({ message: 'Esta skin não serve para este personagem' });
        }

        const updatedRPG = await prisma.visitorRPG.update({
            where: { id: rpg.id },
            data: { equippedSkinId: skinId },
            include: { skin: true }
        });

        res.json(updatedRPG);
    } catch (error: any) {
        console.error('[RPG] Equip skin error:', error);
        res.status(500).json({ message: 'Erro ao equipar skin', error: error.message });
    }
});

// L7: POST /rpg/retry-avatar — Permite resetar um status de erro para tentar novamente
router.post('/retry-avatar', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user!.email.toLowerCase();
        const tenantId = req.user!.tenantId as string;
        const visitor = await prisma.visitor.findFirst({ where: { email: userEmail, tenantId } });
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado' });

        const rpg = await prisma.visitorRPG.findFirst({
            where: { visitorId: visitor.id, isActive: true }
        });

        if (!rpg) return res.status(404).json({ message: 'Personagem não encontrado' });
        
        if (rpg.avatarStatus !== 'ERROR') {
            return res.status(400).json({ message: 'Só é possível resetar avatares com status de erro' });
        }

        await prisma.visitorRPG.update({
            where: { id: rpg.id },
            data: { avatarStatus: 'NONE' }
        });

        res.json({ message: 'Status resetado com sucesso. Você pode tentar gerar novamente.' });
    } catch (err) {
        res.status(500).json({ message: 'Erro ao resetar status' });
    }
});

/**
 * AI AVATAR SYSTEM ROUTES
 */

// POST /rpg/selfie — Receber selfie e iniciar geração
router.post('/selfie', authMiddleware, upload.single('selfie'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'Selfie obrigatória' });
        if (!req.user?.email || !req.user?.tenantId) {
            if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(401).json({ message: 'Não autorizado' });
        }

        const visitor = await prisma.visitor.findFirst({ 
            where: { email: req.user.email.toLowerCase(), tenantId: req.user.tenantId } 
        });
        if (!visitor) {
            if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ message: 'Visitante não encontrado' });
        }

        // Marcar VisitorRPG (o ativo) como GENERATING
        let activeRPG = await prisma.visitorRPG.findFirst({
            where: { visitorId: visitor.id, isActive: true }
        });

        // AUTO-CREATE: Se não tem personagem, cria um herói padrão agora
        if (!activeRPG) {
            activeRPG = await prisma.visitorRPG.create({
                data: { 
                    visitorId: visitor.id, 
                    characterName: 'Explorador', 
                    characterClass: 'NOVATO', 
                    level: 1, 
                    isActive: true,
                    currentXp: 0,
                    nextLevelXp: 100
                }
            });
            console.log(`[RPG] Auto-created hero for visitor ${visitor.id}`);
        }

        await prisma.visitorRPG.update({
            where: { id: activeRPG.id },
            data: { 
                avatarStatus: 'GENERATING', 
                selfieUrl: req.file.path 
            }
        });

        // Resposta imediata
        res.json({ status: 'GENERATING', message: 'Avatar sendo gerado em background...' });

        // Background task
        generateAvatarBackground(visitor.id, activeRPG.id, req.file.path).catch(err => {
            console.error('[AVATAR_BG] Final error:', err);
        });

    } catch (err) {
        console.error('[AVATAR] Error starting generation:', err);
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ message: 'Erro ao processar selfie' });
    }
});

// GET /rpg/avatar-status — Polling do status do avatar
router.get('/avatar-status', authMiddleware, async (req, res) => {
    try {
        if (!req.user?.email || !req.user?.tenantId) return res.status(401).json({ message: 'Não autorizado' });
        const visitor = await prisma.visitor.findFirst({ 
            where: { email: req.user.email.toLowerCase(), tenantId: req.user.tenantId } 
        });
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado' });

        const rpg = await prisma.visitorRPG.findFirst({
            where: { visitorId: visitor.id, isActive: true }
        });

        res.json({
            status: rpg?.avatarStatus || 'NONE',
            baseAvatarUrl: rpg?.baseAvatarUrl || null
        });
    } catch (err) {
        res.status(500).json({ message: 'Erro ao buscar status' });
    }
});

// POST /rpg/apply-skin/:skinId — Aplicar skin via IA
router.post('/apply-skin/:skinId', authMiddleware, async (req, res) => {
    try {
        const { skinId } = req.params;
        if (!req.user?.email || !req.user?.tenantId) return res.status(401).json({ message: 'Não autorizado' });

        const visitor = await prisma.visitor.findFirst({ 
            where: { email: req.user.email.toLowerCase(), tenantId: req.user.tenantId } 
        });
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado' });

        const rpg = await prisma.visitorRPG.findFirst({
            where: { visitorId: visitor.id, isActive: true }
        });

        if (!rpg?.baseAvatarUrl) {
            return res.status(400).json({ message: 'Crie seu avatar personalizado primeiro' });
        }

        // Verificar cache
        const existing = await prisma.visitorAvatarCache.findUnique({
            where: { visitorId_cacheKey: { visitorId: visitor.id, cacheKey: `SKIN:${skinId}` } }
        });

        if (existing?.status === 'READY') {
            return res.json({ status: 'READY', imageUrl: existing.imageUrl });
        }

        // Verificar posse da skin
        const ownership = await prisma.visitorSkin.findUnique({
            where: { visitorId_skinId: { visitorId: visitor.id, skinId } },
            include: { skin: true }
        });

        if (!ownership) return res.status(403).json({ message: 'Skin não adquirida' });

        // Criar/Atualizar entrada no cache
        await prisma.visitorAvatarCache.upsert({
            where: { visitorId_cacheKey: { visitorId: visitor.id, cacheKey: `SKIN:${skinId}` } },
            update: { status: 'GENERATING' },
            create: { visitorId: visitor.id, skinId, cacheKey: `SKIN:${skinId}`, imageUrl: '', status: 'GENERATING' }
        });

        res.json({ status: 'GENERATING', message: 'Aplicando skin via IA em background...' });

        // Background Task
        applySkinBackground(visitor.id, skinId, rpg.baseAvatarUrl, ownership.skin).catch(console.error);

    } catch (err) {
        console.error('[SKIN_IA] Error:', err);
        res.status(500).json({ message: 'Erro ao processar aplicação de skin' });
    }
});

// GET /rpg/skin-status/:skinId — Polling do status da skin
router.get('/skin-status/:skinId', authMiddleware, async (req, res) => {
    try {
        const { skinId } = req.params;
        if (!req.user?.email || !req.user?.tenantId) return res.status(401).json({ message: 'Não autorizado' });

        const visitor = await prisma.visitor.findFirst({ 
            where: { email: req.user.email.toLowerCase(), tenantId: req.user.tenantId } 
        });
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado' });

        const cache = await prisma.visitorAvatarCache.findUnique({
            where: { visitorId_cacheKey: { visitorId: visitor.id, cacheKey: `SKIN:${skinId}` } }
        });

        res.json({
            status: cache?.status || 'NOT_STARTED',
            imageUrl: cache?.status === 'READY' ? cache.imageUrl : null
        });
    } catch (err) {
        res.status(500).json({ message: 'Erro ao buscar status da skin' });
    }
});

/**
 * BACKGROUND HELPERS
 */

async function generateAvatarBackground(visitorId: string, rpgId: string, selfiePath: string) {
    try {
        const base64 = await generateCartoonAvatar(selfiePath);
        const imageUrl = await saveBase64ToR2(base64, `avatars/${visitorId}`, 'base');

        await prisma.visitorRPG.update({
            where: { id: rpgId },
            data: {
                baseAvatarUrl: imageUrl,
                avatarStatus: 'READY',
                avatarGeneratedAt: new Date(),
            }
        });

        // Salvar cache base
        await prisma.visitorAvatarCache.upsert({
            where: { visitorId_cacheKey: { visitorId, cacheKey: 'BASE' } },
            update: { imageUrl, status: 'READY' },
            create: { visitorId, skinId: null, cacheKey: 'BASE', imageUrl, status: 'READY' }
        });

        // Cleanup local selfie
        if (fs.existsSync(selfiePath)) fs.unlinkSync(selfiePath);
        console.log(`[AVATAR] ✅ Sucesso para visitor ${visitorId}`);
    } catch (err) {
        console.error(`[AVATAR] ❌ Erro para ${visitorId}:`, err);
        await prisma.visitorRPG.update({
            where: { id: rpgId },
            data: { avatarStatus: 'ERROR' }
        }).catch(() => {});
    }
}

async function applySkinBackground(visitorId: string, skinId: string, baseAvatarUrl: string, skin: any) {
    const tmpPath = path.join('uploads', `tmp_${visitorId}_${Date.now()}.png`);
    try {
        // Baixar base do R2 para processar (OpenAI precisa de stream/buffer local ou URL acessível se compatível)
        await downloadFile(baseAvatarUrl, tmpPath);

        const base64 = await applySkinToAvatar(tmpPath, (skin as any).imageUrl, (skin as any).name, (skin as any).aiDescription);
        const imageUrl = await saveBase64ToR2(base64, `avatars/${visitorId}/skins`, skinId);

        await prisma.$transaction([
            prisma.visitorAvatarCache.update({
                where: { visitorId_cacheKey: { visitorId, cacheKey: `SKIN:${skinId}` } },
                data: { imageUrl, status: 'READY' }
            }),
            prisma.visitorSkin.update({
                where: { visitorId_skinId: { visitorId, skinId } },
                data: { generatedAvatarUrl: imageUrl }
            })
        ]);

        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        console.log(`[SKIN_IA] ✅ Sucesso para skin ${skinId} em ${visitorId}`);
    } catch (err) {
        console.error(`[SKIN_IA] ❌ Erro skin ${skinId} em ${visitorId}:`, err);
        await prisma.visitorAvatarCache.update({
            where: { visitorId_cacheKey: { visitorId, cacheKey: `SKIN:${skinId}` } },
            data: { status: 'ERROR' }
        }).catch(() => {});
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
}

function downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const client = url.startsWith('https') ? https : http;
        client.get(url, response => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', err => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

export default router;
