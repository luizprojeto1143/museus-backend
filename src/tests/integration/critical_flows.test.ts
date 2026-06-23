// @ts-nocheck
import request from 'supertest';
import { app } from '../../index.js';
import { prisma } from '../../prisma.js';
import bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

describe('Critical Flows Integration Tests', () => {
    jest.setTimeout(60000);
    
    let tenant1Id: string;
    let tenant2Id: string;
    let user1Token: string;
    let user2Token: string;
    
    beforeAll(async () => {
        // Setup two test tenants
        const tenant1 = await prisma.tenant.upsert({
            where: { slug: 'test-tenant-1' },
            update: {},
            create: { name: 'Test Tenant 1', slug: 'test-tenant-1' }
        });
        tenant1Id = tenant1.id;

        const tenant2 = await prisma.tenant.upsert({
            where: { slug: 'test-tenant-2' },
            update: {},
            create: { name: 'Test Tenant 2', slug: 'test-tenant-2' }
        });
        tenant2Id = tenant2.id;

        const password = 'password123';
        const hashedPassword = await bcrypt.hash(password, 10);

        // Setup users for both tenants
        await prisma.user.upsert({
            where: { email: 'user1@tenant1.com' },
            update: { password: hashedPassword, tenantId: tenant1Id, role: Role.ADMIN },
            create: {
                email: 'user1@tenant1.com',
                name: 'User 1',
                password: hashedPassword,
                role: Role.ADMIN,
                tenantId: tenant1Id
            }
        });

        await prisma.user.upsert({
            where: { email: 'user2@tenant2.com' },
            update: { password: hashedPassword, tenantId: tenant2Id, role: Role.ADMIN },
            create: {
                email: 'user2@tenant2.com',
                name: 'User 2',
                password: hashedPassword,
                role: Role.ADMIN,
                tenantId: tenant2Id
            }
        });

        // Login to get tokens
        const login1 = await request(app)
            .post('/auth/login')
            .send({ email: 'user1@tenant1.com', password });
        user1Token = getToken(login1);

        const login2 = await request(app)
            .post('/auth/login')
            .send({ email: 'user2@tenant2.com', password });
        user2Token = getToken(login2);
    });

    afterAll(async () => {
        // Clean up test data
        await prisma.user.deleteMany({
            where: { email: { in: ['user1@tenant1.com', 'user2@tenant2.com'] } }
        });
        await prisma.tenant.deleteMany({
            where: { slug: { in: ['test-tenant-1', 'test-tenant-2'] } }
        });
    });

    function getToken(res: any): string {
        const cookies = res.headers['set-cookie'] as string[];
        const cookie = cookies?.find(c => c.startsWith('museus_token='));
        if (cookie) {
            return cookie.split(';')[0].split('=')[1];
        }
        return '';
    }

    describe('LGPD & Multitenancy IDOR Prevention', () => {
        it('should block a user from retrieving visitor summary from another tenant', async () => {
            // Create a visitor in tenant 2
            const visitor = await prisma.visitor.create({
                data: {
                    tenantId: tenant2Id,
                    name: 'Visitor 2',
                    email: 'visitor2@example.com'
                }
            });

            // Try to view summary of visitor in tenant 2 using user 1's token
            const res = await request(app)
                .get(`/visitors/${visitor.id}/summary`)
                .set('Authorization', `Bearer ${user1Token}`);

            expect(res.status).toBe(403);

            // Clean up
            await prisma.visitor.delete({ where: { id: visitor.id } });
        });

        it('should allow a user to retrieve their own visitor summary', async () => {
            // Create visitor for user 1 email
            const visitor = await prisma.visitor.create({
                data: {
                    tenantId: tenant1Id,
                    name: 'Visitor 1',
                    email: 'user1@tenant1.com'
                }
            });

            const res = await request(app)
                .get(`/visitors/me/summary?email=user1@tenant1.com&tenantId=${tenant1Id}`)
                .set('Authorization', `Bearer ${user1Token}`);

            expect(res.status).toBe(200);
            expect(res.body.email || res.body.xp).toBeDefined();

            // Clean up
            await prisma.visitor.delete({ where: { id: visitor.id } });
        });
    });

    describe('Survey Ownership', () => {
        it('should block non-owners from editing survey questions', async () => {
            // Create an event for tenant 2
            const event = await prisma.event.create({
                data: {
                    tenantId: tenant2Id,
                    title: 'Test Event Tenant 2',
                    startDate: new Date(),
                    isTheaterSession: false
                }
            });

            // User 1 tries to add survey questions to event in tenant 2
            const res = await request(app)
                .post(`/events/${event.id}/survey`)
                .set('Authorization', `Bearer ${user1Token}`)
                .send({
                    questions: [
                        { question: 'Did you like it?', type: 'STARS', required: true }
                    ]
                });

            expect(res.status).toBe(403);

            // Clean up
            await prisma.event.delete({ where: { id: event.id } });
        });
    });
});
