import { Router, Request, Response } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { Role, Prisma } from '@prisma/client';
import { createAuditLog } from '../domains/governance/audit.js';
import bcrypt from 'bcrypt';

const router = Router();

// Helper to resolve a valid tenant ID to avoid foreign key violations in AuditLog
async function getValidTenantId(email: string | null, userTenantId?: string | null): Promise<string> {
    if (userTenantId) return userTenantId;
    if (email) {
        const user = await prisma.user.findFirst({ where: { email } });
        const visitor = await prisma.visitor.findFirst({ where: { email } });
        const tId = user?.tenantId || visitor?.tenantId;
        if (tId) return tId;
    }
    const firstTenant = await prisma.tenant.findFirst();
    return firstTenant?.id || '';
}

// 1. POST /privacy/request - Titular de dados solicita direitos LGPD (Público)
router.post('/request', async (req: Request, res: Response) => {
    try {
        const { name, email, requestType, details } = req.body;

        if (!name || !email || !requestType) {
            return res.status(400).json({ message: 'Nome, e-mail e tipo de solicitação são obrigatórios' });
        }

        const validTypes = ['ACCESS_DATA', 'CORRECT_DATA', 'ANONIMIZE_DATA', 'DELETE_DATA'];
        if (!validTypes.includes(requestType)) {
            return res.status(400).json({ message: 'Tipo de solicitação inválido' });
        }

        const targetTenantId = await getValidTenantId(email);

        // Criar registro de contato especial (LGPD_REQUEST)
        const lgpdRequest = await prisma.contactRequest.create({
            data: {
                name,
                email,
                subject: 'LGPD_REQUEST',
                message: JSON.stringify({
                    requestType,
                    details: details || 'Nenhum detalhe adicional fornecido.'
                }),
                status: 'NEW',
                tenantId: targetTenantId
            }
        });

        // Registrar no log de auditoria
        await createAuditLog(
            'LGPD_REQUEST_CREATED',
            'PRIVACY',
            lgpdRequest.id,
            null,
            email,
            targetTenantId,
            null,
            { requestType, name },
            req
        );

        return res.status(201).json({
            message: 'Solicitação de privacidade registrada com sucesso. O comitê de privacidade (DPO) analisará seu pedido em até 15 dias.',
            requestId: lgpdRequest.id
        });
    } catch (err) {
        console.error('LGPD Request Error:', err);
        return res.status(500).json({ message: 'Erro ao registrar solicitação de privacidade' });
    }
});

// 2. POST /privacy/consent - Registra consentimento do usuário para termos e políticas (Autenticado)
router.post('/consent', authMiddleware, async (req: Request, res: Response) => {
    try {
        const user = req.user!;
        const { policyVersion, accepted } = req.body;

        if (!policyVersion || accepted === undefined) {
            return res.status(400).json({ message: 'Versão da política e status de aceitação são obrigatórios' });
        }

        const targetTenantId = await getValidTenantId(user.email, user.tenantId);

        // Registra o consentimento no log de auditoria oficial (imutável e rastreável)
        await createAuditLog(
            accepted ? 'PRIVACY_CONSENT_ACCEPTED' : 'PRIVACY_CONSENT_REJECTED',
            'PRIVACY',
            null,
            user.id,
            user.email,
            targetTenantId,
            null,
            { policyVersion, accepted },
            req
        );

        return res.json({ success: true, message: 'Consentimento de privacidade registrado com sucesso' });
    } catch (err) {
        console.error('LGPD Consent Error:', err);
        return res.status(500).json({ message: 'Erro ao registrar consentimento' });
    }
});

// 3. GET /privacy/requests - Listar solicitações LGPD (Admin/Master apenas)
router.get('/requests', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req: any, res: Response) => {
    try {
        const user = req.user;
        const where: any = { subject: 'LGPD_REQUEST' };

        // Admin comum só vê solicitações de usuários vinculados ao tenant dele, Master vê tudo
        if (user.role !== Role.MASTER) {
            where.tenantId = user.tenantId;
        }

        const requests = await prisma.contactRequest.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        res.json(requests);
    } catch (err) {
        console.error('LGPD Fetch Error:', err);
        res.status(500).json({ message: 'Erro ao listar solicitações' });
    }
});

// 4. PUT /privacy/requests/:id - Resolver solicitação LGPD com anonimização automática (Admin/Master apenas)
router.put('/requests/:id', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req: any, res: Response) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const user = req.user;

        const record = await prisma.contactRequest.findUnique({ where: { id } });
        if (!record || record.subject !== 'LGPD_REQUEST') {
            return res.status(404).json({ message: 'Solicitação de privacidade não encontrada' });
        }

        // Se for admin comum, valida se pertence ao mesmo tenant (se houver tenantId)
        if (user.role !== Role.MASTER && record.tenantId && record.tenantId !== user.tenantId) {
            return res.status(403).json({ message: 'Sem permissão para alterar esta solicitação' });
        }

        const targetTenantId = await getValidTenantId(record.email, user.tenantId || record.tenantId);

        const payload = JSON.parse(record.message);
        const { requestType } = payload;

        // Se a solicitação foi concluída (COMPLETED) e requer exclusão ou anonimização de dados
        if (status === 'COMPLETED' && (requestType === 'DELETE_DATA' || requestType === 'ANONIMIZE_DATA')) {
            const targetEmail = record.email;

             // 1. Anonimiza usuários com este e-mail no banco e revoga sessões
             const dbUsers = await prisma.user.findMany({ where: { email: targetEmail } });
             const userIds = dbUsers.map(u => u.id);
             if (userIds.length > 0) {
                 await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
                 await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
             }


             for (const u of dbUsers) {
                 const uTenantId = u.tenantId || targetTenantId;
                 const randomPassword = Math.random().toString(36).substring(2) + Date.now().toString();
                 const randomBcryptHash = await bcrypt.hash(randomPassword, 10);

                 await prisma.user.update({
                     where: { id: u.id },
                     data: {
                         name: 'Usuário Anonimizado (LGPD)',
                         email: `anon-${u.id}@lgpd.culturaviva.gov.br`,
                         password: randomBcryptHash,
                         role: Role.COLLABORATOR, // remove privilégios
                         permissions: Prisma.JsonNull
                     }
                 });
                
                await createAuditLog(
                    'LGPD_USER_DATA_ANONIMIZED',
                    'USER',
                    u.id,
                    user.id,
                    user.email,
                    uTenantId,
                    { email: u.email },
                    { email: `anon-${u.id}@lgpd` },
                    req
                );
            }

            // 2. Anonimiza visitantes com este e-mail
            const dbVisitors = await prisma.visitor.findMany({ where: { email: targetEmail } });
            for (const v of dbVisitors) {
                const vTenantId = v.tenantId || targetTenantId;
                await prisma.visitor.update({
                    where: { id: v.id },
                    data: {
                        name: 'Visitante Anonimizado (LGPD)',
                        email: `anon-visitor-${v.id}@lgpd.culturaviva.gov.br`
                    }
                });

                await createAuditLog(
                    'LGPD_VISITOR_DATA_ANONIMIZED',
                    'VISITOR',
                    v.id,
                    user.id,
                    user.email,
                    vTenantId,
                    { email: v.email },
                    { email: `anon-visitor-${v.id}@lgpd` },
                    req
                );
            }
        }

        const updatedRequest = await prisma.contactRequest.update({
            where: { id },
            data: { status }
        });

        await createAuditLog(
            'LGPD_REQUEST_RESOLVED',
            'PRIVACY',
            id,
            user.id,
            user.email,
            targetTenantId,
            { oldStatus: record.status },
            { newStatus: status },
            req
        );

        res.json(updatedRequest);
    } catch (err) {
        console.error('LGPD Resolve Error:', err);
        res.status(500).json({ message: 'Erro ao processar solicitação de privacidade' });
    }
});

export default router;
