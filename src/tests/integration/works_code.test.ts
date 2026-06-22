// @ts-nocheck
import request from 'supertest';
import express from 'express';
import { prisma } from '../../prisma';
import bcrypt from 'bcrypt';
import { Role, QRType } from '@prisma/client';
import worksRoutes from '../../domains/cultural/works.js';
import qrRoutes from '../../routes/qr.js';
import authRoutes from '../../routes/auth.js';

// Setup a minimal app for testing these routes
const app = express();
app.use(express.json());

// Mock user middleware for works routes
app.use((req: any, _res, next) => {
    // Basic mock user injection if token is present (we could also use real auth routes)
    if (req.headers.authorization) {
        // We'll trust the token for this test and mock req.user
    }
    next();
});

app.use('/works', worksRoutes);
app.use('/qr', qrRoutes);
app.use('/auth', authRoutes);

describe('Work Code Integration (Isolated)', () => {
    jest.setTimeout(30000);
    let token: string;
    let tenantId: string;

    beforeAll(async () => {
        // Setup a test tenant and user
        const tenant = await prisma.tenant.upsert({
            where: { slug: 'test-tenant-isolated' },
            update: {},
            create: {
                name: 'Test Tenant Isolated',
                slug: 'test-tenant-isolated',
            }
        });
        tenantId = tenant.id;

        const email = 'test-admin-isolated@example.com';
        const password = 'password123';
        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.user.upsert({
            where: { email },
            update: { password: hashedPassword, tenantId },
            create: {
                email,
                name: 'Test Admin',
                password: hashedPassword,
                role: Role.ADMIN,
                tenantId
            }
        });

        // Get token via real auth route
        const loginRes = await request(app)
            .post('/auth/login')
            .send({ email, password });

        const cookies = loginRes.headers['set-cookie'] as string[];
        const cookie = cookies?.find(c => c.startsWith('museus_token='));
        if (cookie) {
            token = cookie.split(';')[0].split('=')[1];
        }
    });

    it('should create a work and an associated QR code', async () => {
        const uniqueCode = 'CODE' + Date.now();
        const res = await request(app)
            .post('/works')
            .set('Authorization', `Bearer ${token}`)
            .send({
                title: 'Test Work',
                artist: 'Test Artist',
                code: uniqueCode
            });

        expect(res.status).toBe(201);
        const workId = res.body.id;

        // Verify QR code existence via public route
        const qrRes = await request(app).get(`/qr/${uniqueCode}`);
        expect(qrRes.status).toBe(200);
        expect(qrRes.body.referenceId).toBe(workId);
        expect(qrRes.body.type).toBe('WORK');
    });

    it('should fail to create a work with an existing code', async () => {
        const existingCode = 'EXISTING' + Date.now();

        // Create first work
        await request(app)
            .post('/works')
            .set('Authorization', `Bearer ${token}`)
            .send({
                title: 'First Work',
                code: existingCode
            });

        // Try to create second work with same code
        const res = await request(app)
            .post('/works')
            .set('Authorization', `Bearer ${token}`)
            .send({
                title: 'Second Work',
                code: existingCode
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('já está em uso');
    });

    it('should update a work code and synchronize QR code', async () => {
        const oldCode = 'OLD' + Date.now();
        const newCode = 'NEW' + Date.now();

        const createRes = await request(app)
            .post('/works')
            .set('Authorization', `Bearer ${token}`)
            .send({
                title: 'Update Work',
                code: oldCode
            });

        const workId = createRes.body.id;

        // Update to new code
        const updateRes = await request(app)
            .put(`/works/${workId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                title: 'Updated Title',
                code: newCode
            });

        expect(updateRes.status).toBe(200);

        // Old code should be 404
        const oldQrRes = await request(app).get(`/qr/${oldCode}`);
        expect(oldQrRes.status).toBe(404);

        // New code should be 200
        const newQrRes = await request(app).get(`/qr/${newCode}`);
        expect(newQrRes.status).toBe(200);
        expect(newQrRes.body.referenceId).toBe(workId);
        expect(newQrRes.body.title).toBe('Updated Title');
    });

    it('should delete QR code when work is deleted', async () => {
        const deleteCode = 'DELETE' + Date.now();

        const createRes = await request(app)
            .post('/works')
            .set('Authorization', `Bearer ${token}`)
            .send({
                title: 'Delete Work',
                code: deleteCode
            });

        const workId = createRes.body.id;

        // Delete the work
        const deleteRes = await request(app)
            .delete(`/works/${workId}`)
            .set('Authorization', `Bearer ${token}`);

        expect(deleteRes.status).toBe(204);

        // QR code should be gone
        const qrRes = await request(app).get(`/qr/${deleteCode}`);
        expect(qrRes.status).toBe(404);
    });
});


