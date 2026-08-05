import request from 'supertest';
import { app } from '../../index.js';
import { prisma } from '../../prisma.js';
import bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

describe('Tenant Isolation & Permissions Matrix Integration Tests', () => {
    jest.setTimeout(60000);

    let tenant1Id: string;
    let tenant2Id: string;
    let user1Token: string;
    let user2Token: string;
    let testEventTenant2: any;
    let testWorkTenant2: any;
    let testSpaceTenant2: any;

    beforeAll(async () => {
        // Setup two test tenants
        const tenant1 = await prisma.tenant.upsert({
            where: { slug: 'iso-tenant-1' },
            update: {},
            create: { name: 'Isolation Tenant 1', slug: 'iso-tenant-1' }
        });
        tenant1Id = tenant1.id;

        const tenant2 = await prisma.tenant.upsert({
            where: { slug: 'iso-tenant-2' },
            update: {},
            create: { name: 'Isolation Tenant 2', slug: 'iso-tenant-2' }
        });
        tenant2Id = tenant2.id;

        const password = 'password123';
        const hashedPassword = await bcrypt.hash(password, 10);

        // Setup users
        await prisma.user.upsert({
            where: { email: 'admin1@iso1.com' },
            update: { password: hashedPassword, tenantId: tenant1Id, role: Role.ADMIN },
            create: {
                email: 'admin1@iso1.com',
                name: 'Admin 1',
                password: hashedPassword,
                role: Role.ADMIN,
                tenantId: tenant1Id
            }
        });

        await prisma.user.upsert({
            where: { email: 'admin2@iso2.com' },
            update: { password: hashedPassword, tenantId: tenant2Id, role: Role.ADMIN },
            create: {
                email: 'admin2@iso2.com',
                name: 'Admin 2',
                password: hashedPassword,
                role: Role.ADMIN,
                tenantId: tenant2Id
            }
        });

        // Log in
        const login1 = await request(app)
            .post('/auth/login')
            .send({ email: 'admin1@iso1.com', password });
        user1Token = getToken(login1);

        const login2 = await request(app)
            .post('/auth/login')
            .send({ email: 'admin2@iso2.com', password });
        user2Token = getToken(login2);

        // Create test entities in Tenant 2
        testEventTenant2 = await prisma.event.create({
            data: {
                tenantId: tenant2Id,
                title: 'Event Tenant 2',
                startDate: new Date()
            }
        });

        testWorkTenant2 = await prisma.work.create({
            data: {
                tenantId: tenant2Id,
                title: 'Work Tenant 2',
                artist: 'Artist 2',
                year: '2026'
            }
        });

        testSpaceTenant2 = await prisma.space.create({
            data: {
                tenantId: tenant2Id,
                name: 'Space Tenant 2',
                capacity: 50,
                type: 'GALLERY'
            }
        });
    });

    afterAll(async () => {
        // Cleanup
        if (testEventTenant2?.id) {
            await prisma.event.deleteMany({ where: { id: testEventTenant2.id } });
        }
        if (testWorkTenant2?.id) {
            await prisma.work.deleteMany({ where: { id: testWorkTenant2.id } });
        }
        if (testSpaceTenant2?.id) {
            await prisma.space.deleteMany({ where: { id: testSpaceTenant2.id } });
        }
        await prisma.user.deleteMany({ where: { email: { in: ['admin1@iso1.com', 'admin2@iso2.com'] } } });
        const tenantIds = [tenant1Id, tenant2Id].filter(Boolean);
        if (tenantIds.length > 0) {
            await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
        }
    });

    function getToken(res: any): string {
        const cookies = res.headers['set-cookie'] as string[];
        const cookie = cookies?.find(c => c.startsWith('museus_token='));
        if (cookie) {
            return cookie.split(';')[0].split('=')[1];
        }
        return '';
    }

    describe('Tenant Isolation checks via assertTenantOwnership', () => {
        it('should block admin1 from updating event of tenant2', async () => {
            const res = await request(app)
                .put(`/events/${testEventTenant2.id}`)
                .set('Authorization', `Bearer ${user1Token}`)
                .send({
                    title: 'Attacked Event Name',
                    startDate: new Date().toISOString()
                });
            expect(res.status).toBe(403);
        });

        it('should block admin1 from deleting event of tenant2', async () => {
            const res = await request(app)
                .delete(`/events/${testEventTenant2.id}`)
                .set('Authorization', `Bearer ${user1Token}`);
            expect(res.status).toBe(403);
        });

        it('should block admin1 from retrieving space of tenant2', async () => {
            const res = await request(app)
                .get(`/spaces/${testSpaceTenant2.id}`)
                .set('Authorization', `Bearer ${user1Token}`);
            expect(res.status).toBe(403);
        });

        it('should block admin1 from updating space of tenant2', async () => {
            const res = await request(app)
                .put(`/spaces/${testSpaceTenant2.id}`)
                .set('Authorization', `Bearer ${user1Token}`)
                .send({
                    name: 'Attacked Space Name'
                });
            expect(res.status).toBe(403);
        });

        it('should block admin1 from updating work of tenant2', async () => {
            const res = await request(app)
                .put(`/works/${testWorkTenant2.id}`)
                .set('Authorization', `Bearer ${user1Token}`)
                .send({
                    title: 'Attacked Work Name'
                });
            expect(res.status).toBe(403);
        });

        it('should block admin1 from deleting work of tenant2', async () => {
            const res = await request(app)
                .delete(`/works/${testWorkTenant2.id}`)
                .set('Authorization', `Bearer ${user1Token}`);
            expect(res.status).toBe(403);
        });
    });
});
