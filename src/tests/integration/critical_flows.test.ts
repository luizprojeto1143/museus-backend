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

    describe('Curator Note IDOR Prevention', () => {
        it('should block non-owners from editing curator notes', async () => {
            // Create a work for tenant 2
            const work = await prisma.work.create({
                data: {
                    tenantId: tenant2Id,
                    title: 'Work Tenant 2',
                    artist: 'Artist 2',
                    year: '2026'
                }
            });

            // Create a curator note for work in tenant 2
            const note = await prisma.curatorNote.create({
                data: {
                    tenantId: tenant2Id,
                    workId: work.id,
                    content: 'Nice work!'
                }
            });

            // User 1 tries to edit the note in tenant 2
            const res = await request(app)
                .put(`/curator-notes/${note.id}`)
                .set('Authorization', `Bearer ${user1Token}`)
                .send({
                    content: 'Updated by attacker'
                });

            expect(res.status).toBe(403);

            // Clean up
            await prisma.curatorNote.delete({ where: { id: note.id } });
            await prisma.work.delete({ where: { id: work.id } });
        });
    });

    describe('Financial Ledger Synchronization', () => {
        it('should synchronize FinancialTransaction with FinancialLedgerEntry', async () => {
            // Create a completed financial transaction manually
            const tx = await prisma.financialTransaction.create({
                data: {
                    tenantId: tenant1Id,
                    type: 'PAYMENT',
                    source: 'DONATION',
                    amount: 100.00,
                    fee: 5.00,
                    netAmount: 95.00,
                    status: 'COMPLETED',
                    paymentMethod: 'CREDIT_CARD',
                    stripePaymentIntentId: 'pi_test_ledger_sync'
                }
            });

            // Call syncLedgerEntry manually as we would in the code
            const { syncLedgerEntry } = await import('../../services/ledgerService.js');
            await syncLedgerEntry(prisma, tx.id);

            // Verify a ledger entry exists for this transaction
            const ledgerEntry = await prisma.financialLedgerEntry.findFirst({
                where: { stripePaymentIntentId: 'pi_test_ledger_sync' }
            });

            expect(ledgerEntry).toBeDefined();
            expect(ledgerEntry?.direction).toBe('CREDIT');
            expect(Number(ledgerEntry?.grossAmount)).toBe(100.00);
            expect(Number(ledgerEntry?.netAmount)).toBe(95.00);

            // Clean up
            await prisma.financialLedgerEntry.deleteMany({
                where: { stripePaymentIntentId: 'pi_test_ledger_sync' }
            });
            await prisma.financialTransaction.delete({ where: { id: tx.id } });
        });
    });

    describe('Stripe Webhook Stale Lock and Reprocessing', () => {
        it('should allow reprocessing if a lock is PROCESSING but stale (updatedAt > 10 min)', async () => {
            const eventId = 'evt_stale_lock_test_' + Date.now();
            
            // Create a stale lock manually in the database
            const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);
            await prisma.stripeWebhookEvent.create({
                data: {
                    id: eventId,
                    type: 'payment_intent.created',
                    status: 'PROCESSING',
                    createdAt: elevenMinutesAgo,
                    updatedAt: elevenMinutesAgo
                }
            });

            // Mock constructEvent
            const { stripe } = await import('../../services/stripeService.js');
            const constructSpy = jest.spyOn(stripe.webhooks, 'constructEvent');
            constructSpy.mockReturnValue({
                id: eventId,
                type: 'payment_intent.created',
                data: { object: { id: 'sess_stale_lock_test', metadata: {} } }
            });

            // Call the route using supertest
            const res = await request(app)
                .post('/webhooks/stripe')
                .set('stripe-signature', 'valid_sig')
                .send({ some: 'payload' });

            // Since checkout.session.completed does nothing if there is no registration, it will succeed and return 200
            expect(res.status).toBe(200);

            // Verify status in DB transitioned to IGNORED
            const dbEvent = await prisma.stripeWebhookEvent.findUnique({
                where: { id: eventId }
            });
            expect(dbEvent).toBeDefined();
            expect(dbEvent?.status).toBe('IGNORED');

            // Clean up and restore mock
            constructSpy.mockRestore();
            await prisma.stripeWebhookEvent.delete({ where: { id: eventId } });
        });
    });

    describe('Concurrent Refund Lock', () => {
        it('should prevent double refund exceeding refundable balance', async () => {
            // Create a test financial transaction
            const tx = await prisma.financialTransaction.create({
                data: {
                    tenantId: tenant1Id,
                    type: 'PAYMENT',
                    source: 'DONATION',
                    amount: 100.00,
                    fee: 5.00,
                    netAmount: 95.00,
                    status: 'COMPLETED',
                    paymentMethod: 'CREDIT_CARD',
                    stripePaymentIntentId: 'pi_refund_lock_test'
                }
            });

            // Simulate another refund record in PENDING status
            await prisma.refund.create({
                data: {
                    transactionId: tx.id,
                    tenantId: tenant1Id,
                    amount: 60.00,
                    status: 'PENDING',
                    reason: 'requested_by_customer'
                }
            });

            // Try to request another refund of 50.00 (which exceeds the remaining 40.00 balance)
            const res = await request(app)
                .post(`/financial/refund/${tx.id}`)
                .set('Authorization', `Bearer ${user1Token}`)
                .send({
                    amount: 50.00
                });

            // It should be blocked and return 400 because 60 (pending) + 50 (new request) > 100
            expect(res.status).toBe(400);
            expect(res.body.message).toContain('excede o saldo restante reembolsável');

            // Clean up
            await prisma.refund.deleteMany({ where: { transactionId: tx.id } });
            await prisma.financialTransaction.delete({ where: { id: tx.id } });
        });
    });
});
