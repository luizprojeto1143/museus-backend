import request from 'supertest';
import { app } from '../../index.js';
import { prisma } from '../../prisma.js';
import bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

// Mock Stripe charges API for reconciliation
jest.mock('../../services/stripeService.js', () => {
    return {
        stripe: {
            charges: {
                list: jest.fn().mockResolvedValue({
                    data: [
                        {
                            id: 'ch_test_reconciliation_1',
                            payment_intent: 'pi_test_reconciliation_1',
                            amount: 15000, // 150.00 BRL
                            status: 'succeeded',
                            created: Math.floor(Date.now() / 1000)
                        }
                    ]
                }),
                retrieve: jest.fn().mockImplementation((id) => {
                    return Promise.resolve({
                        id,
                        payment_intent: 'pi_test_reconciliation_1',
                        amount: 15000, // 150.00 BRL
                        status: 'succeeded',
                        created: Math.floor(Date.now() / 1000)
                    });
                })
            }
        },
        stripeService: {}
    };
});

describe('Financial Módulo & ERP Integration Tests', () => {
    jest.setTimeout(60000);

    let tenantId: string;
    let userToken: string;
    let costCenterId: string;
    let categoryId: string;
    let receivableId: string;
    let payableId: string;
    let payoutId: string;

    beforeAll(async () => {
        // Setup test tenant
        const tenant = await prisma.tenant.upsert({
            where: { slug: 'finance-test-tenant' },
            update: {},
            create: { name: 'Finance Test Tenant', slug: 'finance-test-tenant' }
        });
        tenantId = tenant.id;

        // Clean slate to prevent collision with aborted/previous test runs
        await prisma.accountsReceivable.deleteMany({ where: { tenantId } });
        await prisma.accountsPayable.deleteMany({ where: { tenantId } });
        await prisma.costCenter.deleteMany({ where: { tenantId } });
        await prisma.accountingCategory.deleteMany({ where: { tenantId } });
        await prisma.payoutLedger.deleteMany({ where: { tenantId } });
        await prisma.financialLedgerEntry.deleteMany({ where: { tenantId } });

        const password = 'password123';
        const hashedPassword = await bcrypt.hash(password, 10);

        // Setup admin user
        await prisma.user.upsert({
            where: { email: 'finance.admin@test.com' },
            update: { password: hashedPassword, tenantId, role: Role.ADMIN },
            create: {
                email: 'finance.admin@test.com',
                name: 'Finance Admin',
                password: hashedPassword,
                role: Role.ADMIN,
                tenantId
            }
        });

        // Log in to get token
        const login = await request(app)
            .post('/auth/login')
            .send({ email: 'finance.admin@test.com', password });
        
        const cookies = login.headers['set-cookie'] as unknown as string[];
        const cookie = cookies?.find(c => c.startsWith('museus_token='));
        if (cookie) {
            userToken = cookie.split(';')[0].split('=')[1];
        }
    });

    afterAll(async () => {
        // Cleanup all records created in this test suite
        await prisma.accountsReceivable.deleteMany({ where: { tenantId } });
        await prisma.accountsPayable.deleteMany({ where: { tenantId } });
        await prisma.costCenter.deleteMany({ where: { tenantId } });
        await prisma.accountingCategory.deleteMany({ where: { tenantId } });
        await prisma.payoutLedger.deleteMany({ where: { tenantId } });
        await prisma.financialLedgerEntry.deleteMany({ where: { tenantId } });
        await prisma.user.deleteMany({ where: { email: 'finance.admin@test.com' } });
        await prisma.tenant.deleteMany({ where: { id: tenantId } });
    });

    describe('Cost Centers & Accounting Categories', () => {
        it('should create a cost center', async () => {
            const res = await request(app)
                .post('/finance/cost-centers')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    name: 'Gerais',
                    code: 'CC-001',
                    description: 'Despesas Gerais'
                });
            expect(res.status).toBe(201);
            expect(res.body.name).toBe('Gerais');
            costCenterId = res.body.id;
        });

        it('should list cost centers', async () => {
            const res = await request(app)
                .get('/finance/cost-centers')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.some((c: { id: string }) => c.id === costCenterId)).toBe(true);
        });

        it('should create an accounting category', async () => {
            const res = await request(app)
                .post('/finance/accounting-categories')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    name: 'Receita Operacional',
                    type: 'REVENUE',
                    code: 'CAT-001',
                    description: 'Receitas de bilheteria e loja'
                });
            expect(res.status).toBe(201);
            expect(res.body.name).toBe('Receita Operacional');
            categoryId = res.body.id;
        });

        it('should list accounting categories', async () => {
            const res = await request(app)
                .get('/finance/accounting-categories')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.some((c: { id: string }) => c.id === categoryId)).toBe(true);
        });
    });

    describe('Accounts Receivable', () => {
        it('should create an account receivable', async () => {
            const res = await request(app)
                .post('/finance/accounts-receivable')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    description: 'Bilheteria Evento A',
                    amount: 500.50,
                    dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
                    status: 'PENDING',
                    costCenterId,
                    categoryId
                });
            expect(res.status).toBe(201);
            expect(res.body.description).toBe('Bilheteria Evento A');
            receivableId = res.body.id;
        });

        it('should list accounts receivable', async () => {
            const res = await request(app)
                .get('/finance/accounts-receivable')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.some((r: { id: string }) => r.id === receivableId)).toBe(true);
        });

        it('should update an account receivable', async () => {
            const res = await request(app)
                .put(`/finance/accounts-receivable/${receivableId}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    description: 'Bilheteria Evento A - Pago',
                    status: 'RECEIVED',
                    paidAmount: 500.50,
                    paidAt: new Date().toISOString()
                });
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('RECEIVED');
            expect(res.body.description).toBe('Bilheteria Evento A - Pago');
        });
    });

    describe('Accounts Payable', () => {
        it('should create an account payable', async () => {
            const res = await request(app)
                .post('/finance/accounts-payable')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    description: 'Manutenção de Ar-condicionado',
                    amount: 350.00,
                    dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
                    status: 'PENDING',
                    costCenterId,
                    categoryId
                });
            expect(res.status).toBe(201);
            expect(res.body.description).toBe('Manutenção de Ar-condicionado');
            payableId = res.body.id;
        });

        it('should list accounts payable', async () => {
            const res = await request(app)
                .get('/finance/accounts-payable')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.some((p: { id: string }) => p.id === payableId)).toBe(true);
        });

        it('should update an account payable', async () => {
            const res = await request(app)
                .put(`/finance/accounts-payable/${payableId}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    description: 'Manutenção de Ar-condicionado - Paga',
                    status: 'PAID',
                    paidAmount: 350.00,
                    paidAt: new Date().toISOString()
                });
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('PAID');
        });
    });

    describe('DRE & Ledger Accounting & Reconciliation', () => {
        beforeAll(async () => {
            // Seed a FinancialLedgerEntry Credit
            await prisma.financialLedgerEntry.create({
                data: {
                    tenantId,
                    sourceType: 'ORDER',
                    sourceId: 'dummy_order_1',
                    direction: 'CREDIT',
                    grossAmount: 150.00,
                    gatewayFee: 5.00,
                    platformFee: 4.50,
                    netAmount: 140.50,
                    status: 'COMPLETED',
                    paymentMethod: 'CREDIT_CARD',
                    stripeChargeId: 'ch_test_reconciliation_1',
                    stripePaymentIntentId: 'pi_test_reconciliation_1',
                    competenceDate: new Date()
                }
            });

            // Seed a PayoutLedger entry
            const payout = await prisma.payoutLedger.create({
                data: {
                    tenantId,
                    recipientType: 'MUSEUM',
                    recipientId: tenantId,
                    grossAmount: 150.00,
                    platformFee: 4.50,
                    gatewayFee: 5.00,
                    netAmount: 140.50,
                    status: 'PENDING',
                    availableAt: new Date(Date.now() - 1000) // already available
                }
            });
            payoutId = payout.id;
        });

        it('should fetch the municipal DRE contábil', async () => {
            const res = await request(app)
                .get('/finance/dre')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.status).toBe(200);
            expect(res.body.dre.grossRevenue).toBe(150.00);
            expect(res.body.dre.netRevenue).toBe(140.50);
            expect(res.body.summary.accountsReceivableCount).toBe(1);
            expect(res.body.summary.accountsPayableCount).toBe(1);
        });

        it('should run bank reconciliation with Stripe data', async () => {
            const res = await request(app)
                .get('/finance/reconciliation')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.status).toBe(200);
            expect(res.body.summary.matchedCount).toBe(1);
            expect(res.body.summary.totalStripeChecked).toBe(1);
        });

        it('should list payouts', async () => {
            const res = await request(app)
                .get('/finance/payouts')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.some((p: { id: string }) => p.id === payoutId)).toBe(true);
        });

        it('should release pending payouts', async () => {
            const res = await request(app)
                .post('/finance/payouts/release')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.releasedCount).toBeGreaterThanOrEqual(1);
        });
    });
});


