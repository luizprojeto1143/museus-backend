import request from 'supertest';
import { app } from '../../index.js';
import { prisma } from '../../prisma.js';
import bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

describe('LGPD Privacy & Consent Integration Tests', () => {
    jest.setTimeout(60000);

    let tenantId: string;
    let userToken: string;
    let targetUserId: string;
    let targetVisitorId: string;
    let lgpdRequestId: string;
    const targetEmail = 'target.user.lgpd@test.com';

    beforeAll(async () => {
        // Setup test tenant
        const tenant = await prisma.tenant.upsert({
            where: { slug: 'privacy-test-tenant' },
            update: {},
            create: { name: 'Privacy Test Tenant', slug: 'privacy-test-tenant' }
        });
        tenantId = tenant.id;

        // Clean up residue from previous runs
        await prisma.visitor.deleteMany({ where: { email: targetEmail } });
        await prisma.contactRequest.deleteMany({ where: { subject: 'LGPD_REQUEST' } });

        const password = 'password123';
        const hashedPassword = await bcrypt.hash(password, 10);

        // Setup admin user
        await prisma.user.upsert({
            where: { email: 'privacy.admin@test.com' },
            update: { password: hashedPassword, tenantId, role: Role.ADMIN },
            create: {
                email: 'privacy.admin@test.com',
                name: 'Privacy Admin',
                password: hashedPassword,
                role: Role.ADMIN,
                tenantId
            }
        });

        // Setup target user to be anonymized
        const targetUser = await prisma.user.upsert({
            where: { email: targetEmail },
            update: { password: hashedPassword, tenantId, role: Role.COLLABORATOR },
            create: {
                email: targetEmail,
                name: 'Target User LGPD',
                password: hashedPassword,
                role: Role.COLLABORATOR,
                tenantId
            }
        });
        targetUserId = targetUser.id;

        // Setup target visitor to be anonymized
        const targetVisitor = await prisma.visitor.create({
            data: {
                name: 'Target Visitor LGPD',
                email: targetEmail,
                tenantId
            }
        });
        targetVisitorId = targetVisitor.id;

        // Log in as admin
        const login = await request(app)
            .post('/auth/login')
            .send({ email: 'privacy.admin@test.com', password });
        
        const cookies = login.headers['set-cookie'] as unknown as string[];
        const cookie = cookies?.find(c => c.startsWith('museus_token='));
        if (cookie) {
            userToken = cookie.split(';')[0].split('=')[1];
        }
    });

    afterAll(async () => {
        // Cleanup remaining entries
        await prisma.contactRequest.deleteMany({ where: { subject: 'LGPD_REQUEST' } });
        if (targetUserId) {
            await prisma.user.deleteMany({ where: { id: { in: [targetUserId] } } });
        }
        await prisma.user.deleteMany({ where: { email: { in: ['privacy.admin@test.com'] } } });
        if (targetVisitorId) {
            await prisma.visitor.deleteMany({ where: { id: targetVisitorId } });
        }
        if (tenantId) {
            await prisma.tenant.deleteMany({ where: { id: tenantId } });
        }
    });

    describe('Privacy Requests & Consent Flows', () => {
        it('should submit a privacy request', async () => {
            const res = await request(app)
                .post('/privacy/request')
                .send({
                    name: 'Target User LGPD',
                    email: targetEmail,
                    requestType: 'ANONIMIZE_DATA',
                    details: 'Por favor, anonimize todos os meus registros.'
                });
            expect(res.status).toBe(201);
            expect(res.body.message).toContain('Solicitação de privacidade registrada');
            lgpdRequestId = res.body.requestId;
        });

        it('should register privacy policy consent', async () => {
            const res = await request(app)
                .post('/privacy/consent')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    policyVersion: 'v2.1',
                    accepted: true
                });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should list privacy requests for admin', async () => {
            const res = await request(app)
                .get('/privacy/requests')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.some((r: { id: string }) => r.id === lgpdRequestId)).toBe(true);
        });

        it('should resolve request and trigger automated user/visitor anonymization', async () => {
            // Check pre-anonymized status
            const userBefore = await prisma.user.findUnique({ where: { id: targetUserId } });
            const visitorBefore = await prisma.visitor.findUnique({ where: { id: targetVisitorId } });
            expect(userBefore).not.toBeNull();
            expect(visitorBefore).not.toBeNull();
            expect(userBefore!.email).toBe(targetEmail);
            expect(visitorBefore!.email).toBe(targetEmail);

            // Admin resolves request as COMPLETED
            const res = await request(app)
                .put(`/privacy/requests/${lgpdRequestId}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    status: 'COMPLETED'
                });
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('COMPLETED');

            // Verify user has been anonymized
            const userAfter = await prisma.user.findUnique({ where: { id: targetUserId } });
            expect(userAfter).not.toBeNull();
            expect(userAfter!.name).toBe('Usuário Anonimizado (LGPD)');
            expect(userAfter!.email).toContain('anon-');
            expect(userAfter!.email).not.toBe(targetEmail);

            // Verify visitor has been anonymized
            const visitorAfter = await prisma.visitor.findUnique({ where: { id: targetVisitorId } });
            expect(visitorAfter).not.toBeNull();
            expect(visitorAfter!.name).toBe('Visitante Anonimizado (LGPD)');
            expect(visitorAfter!.email).toContain('anon-visitor-');
            expect(visitorAfter!.email).not.toBe(targetEmail);
        });
    });
});


