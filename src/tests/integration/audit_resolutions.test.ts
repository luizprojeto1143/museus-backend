// @ts-nocheck
import request from 'supertest';
import { app } from '../../index.js';
import { prisma } from '../../prisma.js';
import bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

// Mock Stripe charges and transfers API for the tests
jest.mock('../../services/stripeService.js', () => {
    return {
        stripe: {
            charges: {
                retrieve: jest.fn().mockImplementation((id) => {
                    return Promise.resolve({
                        id,
                        payment_intent: 'pi_reconcile_test',
                        amount: 10000,
                        status: 'succeeded',
                        created: Math.floor(Date.now() / 1000)
                    });
                })
            },
            transfers: {
                create: jest.fn().mockResolvedValue({ id: 'tr_test_123' })
            },
            paymentIntents: {
                retrieve: jest.fn().mockResolvedValue({
                    id: 'pi_test_seat_lock',
                    latest_charge: 'ch_test_seat_lock'
                })
            }
        },
        stripeService: {
            createCustomer: jest.fn().mockResolvedValue('cus_test_123'),
            createSplitPaymentSession: jest.fn().mockResolvedValue({
                id: 'cs_test_theater_123',
                url: 'https://checkout.stripe.com/pay/cs_test_theater_123'
            })
        }
    };
});

describe('Audit Resolutions Integration Tests', () => {
    jest.setTimeout(60000);

    let tenantId: string;
    let otherTenantId: string;
    let userToken: string;
    let adminEmail = 'audit.admin@test.com';

    beforeAll(async () => {
        // Setup test tenants
        const tenant = await prisma.tenant.upsert({
            where: { slug: 'audit-test-tenant-1' },
            update: {},
            create: { name: 'Audit Test Tenant 1', slug: 'audit-test-tenant-1' }
        });
        tenantId = tenant.id;

        const otherTenant = await prisma.tenant.upsert({
            where: { slug: 'audit-test-tenant-2' },
            update: {},
            create: { name: 'Audit Test Tenant 2', slug: 'audit-test-tenant-2' }
        });
        otherTenantId = otherTenant.id;

        // Clean database state
        await prisma.refreshToken.deleteMany({});
        await prisma.passwordResetToken.deleteMany({});
        await prisma.user.deleteMany({ where: { email: { in: [adminEmail, 'target.lgpd@test.com'] } } });
        await prisma.payoutLedger.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
        await prisma.financialLedgerEntry.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
        await prisma.theaterSeatReservation.deleteMany({ where: { eventId: 'event-theater-test' } });
        await prisma.event.deleteMany({ where: { id: { in: ['event-theater-test', 'event-ticket-test'] } } });

        const hashedPassword = await bcrypt.hash('password123', 10);

        // Create admin user for tenant 1
        await prisma.user.create({
            data: {
                email: adminEmail,
                name: 'Audit Admin',
                password: hashedPassword,
                role: Role.ADMIN,
                tenantId
            }
        });

        // Log in to get token
        const login = await request(app)
            .post('/auth/login')
            .send({ email: adminEmail, password: 'password123' });
        
        const cookies = login.headers['set-cookie'] as string[];
        const cookie = cookies?.find(c => c.startsWith('museus_token='));
        if (cookie) {
            userToken = cookie.split(';')[0].split('=')[1];
        }
    });

    afterAll(async () => {
        // Cleanup all test records
        await prisma.refreshToken.deleteMany({});
        await prisma.passwordResetToken.deleteMany({});
        await prisma.user.deleteMany({ where: { email: { in: [adminEmail, 'target.lgpd@test.com'] } } });
        await prisma.payoutLedger.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
        await prisma.financialLedgerEntry.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
        await prisma.theaterSeatReservation.deleteMany({ where: { eventId: 'event-theater-test' } });
        await prisma.event.deleteMany({ where: { id: { in: ['event-theater-test', 'event-ticket-test'] } } });
        await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    });

    describe('LGPD Session Revocation & BCrypt Compliance', () => {
        it('should revoke active tokens and anonymize password safely', async () => {
            const targetEmail = 'target.lgpd@test.com';
            const userPassword = 'userPass123';
            const hashed = await bcrypt.hash(userPassword, 10);

            // 1. Create target user
            const testUser = await prisma.user.create({
                data: {
                    email: targetEmail,
                    name: 'Target User LGPD',
                    password: hashed,
                    role: Role.COLLABORATOR,
                    tenantId
                }
            });

            // 2. Create active tokens
            await prisma.refreshToken.create({
                data: {
                    token: 'active_refresh_token_xyz',
                    userId: testUser.id,
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
                }
            });

            await prisma.passwordResetToken.create({
                data: {
                    tokenHash: 'hashed_reset_token_xyz',
                    userId: testUser.id,
                    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
                }
            });

            // 3. Create LGPD contact request
            const contactReq = await prisma.contactRequest.create({
                data: {
                    name: 'Target User LGPD',
                    email: targetEmail,
                    subject: 'LGPD_REQUEST',
                    message: JSON.stringify({ requestType: 'ANONIMIZE_DATA' }),
                    status: 'NEW',
                    tenantId
                }
            });

            // 4. Resolve LGPD request as Admin
            const res = await request(app)
                .put(`/privacy/requests/${contactReq.id}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ status: 'COMPLETED' });

            expect(res.status).toBe(200);

            // 5. Verify user is anonymized, password is valid bcrypt and active tokens are deleted
            const updatedUser = await prisma.user.findUnique({ where: { id: testUser.id } });
            expect(updatedUser.name).toBe('Usuário Anonimizado (LGPD)');
            expect(updatedUser.email).toContain(`anon-${testUser.id}`);
            expect(updatedUser.password.startsWith('$2b$')).toBe(true);

            const activeRefresh = await prisma.refreshToken.findMany({ where: { userId: testUser.id } });
            expect(activeRefresh.length).toBe(0);

            const activeReset = await prisma.passwordResetToken.findMany({ where: { userId: testUser.id } });
            expect(activeReset.length).toBe(0);
        });
    });

    describe('Tenant Scoping of Payout Release', () => {
        it('should release payouts only for the authenticated admin tenant', async () => {
            const now = new Date();

            // Payout belonging to admin's tenant (should be released)
            await prisma.payoutLedger.create({
                data: {
                    tenantId,
                    recipientType: 'MUSEUM',
                    recipientId: tenantId,
                    grossAmount: 50.00,
                    platformFee: 1.50,
                    gatewayFee: 1.00,
                    netAmount: 47.50,
                    status: 'PENDING',
                    availableAt: new Date(now.getTime() - 1000)
                }
            });

            // Payout belonging to another tenant (should NOT be released)
            await prisma.payoutLedger.create({
                data: {
                    tenantId: otherTenantId,
                    recipientType: 'MUSEUM',
                    recipientId: otherTenantId,
                    grossAmount: 100.00,
                    platformFee: 3.00,
                    gatewayFee: 2.00,
                    netAmount: 95.00,
                    status: 'PENDING',
                    availableAt: new Date(now.getTime() - 1000)
                }
            });

            // Trigger payout release as admin
            const res = await request(app)
                .post('/finance/payouts/release')
                .set('Authorization', `Bearer ${userToken}`);

            expect(res.status).toBe(200);
            expect(res.body.releasedCount).toBe(1);

            // Verify status in DB
            const tenantPayouts = await prisma.payoutLedger.findMany({ where: { tenantId } });
            expect(tenantPayouts[0].status).toBe('AVAILABLE');

            const otherPayouts = await prisma.payoutLedger.findMany({ where: { tenantId: otherTenantId } });
            expect(otherPayouts[0].status).toBe('PENDING');
        });
    });

    describe('Theater Seat Session-Lock Validation', () => {
        it('should block seat webhook confirmation if stripe session id mismatch', async () => {
            // Setup a dummy theater event
            await prisma.event.create({
                data: {
                    id: 'event-theater-test',
                    title: 'Theater Show',
                    isTheaterSession: true,
                    startDate: new Date(),
                    tenantId
                }
            });

            // Setup seat reservation group with session 'checkout_123'
            const group = await prisma.theaterSeatReservationGroup.create({
                data: {
                    tenantId,
                    eventId: 'event-theater-test',
                    status: 'PENDING',
                    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
                    stripeCheckoutSessionId: 'checkout_123'
                }
            });

            // Setup seat reservation linked to that group
            await prisma.theaterSeatReservation.create({
                data: {
                    eventId: 'event-theater-test',
                    seatId: 'A-1',
                    status: 'RESERVED',
                    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
                    stripeCheckoutSessionId: 'checkout_123',
                    reservationGroupId: group.id
                }
            });

            // Simulate stripe webhook with incorrect checkout session
            const { handleWebhookEvent } = await import('../../routes/webhooks.js');
            const stripeEvent = {
                id: 'evt_test_seat_lock',
                type: 'checkout.session.completed',
                data: {
                    object: {
                        id: 'checkout_different', // mismatch
                        payment_intent: 'pi_test_seat_lock',
                        payment_status: 'paid',
                        amount_total: 10000,
                        metadata: {
                            type: 'THEATER',
                            eventId: 'event-theater-test',
                            reservationGroupId: group.id,
                            tenantId
                        }
                    }
                }
            };

            await expect(handleWebhookEvent(stripeEvent)).rejects.toThrow('Conflito de Assento');

            // Verify status is still RESERVED in database
            const seat = await prisma.theaterSeatReservation.findUnique({
                where: { eventId_seatId: { eventId: 'event-theater-test', seatId: 'A-1' } }
            });
            expect(seat.status).toBe('RESERVED');
        });
    });
});
