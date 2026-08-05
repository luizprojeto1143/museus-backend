import Stripe from 'stripe';

const STRIPE_PLACEHOLDER_KEY = 'sk_test_missing_key_please_configure_in_render_env_vars';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || STRIPE_PLACEHOLDER_KEY;
const BILLING_MODE = process.env.BILLING_MODE || (process.env.PAYMENTS_DISABLED === "true" ? "disabled" : "live");
const PAYMENTS_DISABLED = BILLING_MODE === "disabled";
const IS_PLACEHOLDER = STRIPE_SECRET_KEY.includes('missing_key') || STRIPE_SECRET_KEY === STRIPE_PLACEHOLDER_KEY;

if (IS_PLACEHOLDER && process.env.NODE_ENV === 'production' && !PAYMENTS_DISABLED) {
    throw new Error('STRIPE_SECRET_KEY is required in production when billing is enabled.');
}

if (IS_PLACEHOLDER && !PAYMENTS_DISABLED) {
    console.warn("STRIPE_SECRET_KEY not configured. Development payment calls will be simulated.");
}

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2025-01-27' as any,
});

function checkPaymentsEnabled() {
    if (PAYMENTS_DISABLED) {
        throw new Error("Os pagamentos estao desativados nesta instancia do servidor.");
    }
}

interface CustomerData {
    name: string;
    email: string;
    userId: string;
    metadata?: Record<string, string>;
}

export const stripeService = {
    async createCustomer(data: CustomerData) {
        checkPaymentsEnabled();
        if (IS_PLACEHOLDER) {
            console.log("[STRIPE SIMULATION] Creating dummy customer for:", data.email);
            return `cus_dummy_${Math.random().toString(36).substring(7)}`;
        }
        try {
            const customers = await stripe.customers.list({
                email: data.email,
                limit: 1
            });

            if (customers.data.length > 0) {
                return customers.data[0].id;
            }

            const customer = await stripe.customers.create({
                name: data.name,
                email: data.email,
                metadata: {
                    userId: data.userId,
                    ...data.metadata
                }
            });

            return customer.id;
        } catch (error: any) {
            console.error('Stripe Create Customer Error:', error.message);
            throw new Error('Falha ao registrar cliente no Stripe');
        }
    },

    async createSubscriptionSession(customerId: string, priceId: string, successUrl: string, cancelUrl: string) {
        checkPaymentsEnabled();
        if (IS_PLACEHOLDER) {
            console.log("[STRIPE SIMULATION] Skipping subscription session, redirecting to successUrl.");
            return { url: successUrl } as any;
        }
        try {
            const session = await stripe.checkout.sessions.create({
                customer: customerId,
                payment_method_types: ['card'],
                line_items: [
                    {
                        price: priceId,
                        quantity: 1,
                    },
                ],
                mode: 'subscription',
                success_url: successUrl,
                cancel_url: cancelUrl,
            });

            return session;
        } catch (error: any) {
            console.error('Stripe Subscription Session Error:', error.message);
            throw new Error('Falha ao criar sessao de assinatura');
        }
    },

    async createSubscriptionSessionWithPriceData(data: {
        customerId: string;
        amountCents: number;
        name: string;
        successUrl: string;
        cancelUrl: string;
        metadata?: Record<string, string>;
    }) {
        checkPaymentsEnabled();
        if (IS_PLACEHOLDER) {
            console.log("[STRIPE SIMULATION] Skipping dynamic subscription session, redirecting to successUrl.");
            return { url: data.successUrl } as any;
        }
        try {
            const session = await stripe.checkout.sessions.create({
                customer: data.customerId,
                payment_method_types: ['card'],
                line_items: [
                    {
                        price_data: {
                            currency: 'brl',
                            product_data: {
                                name: data.name,
                            },
                            unit_amount: data.amountCents,
                            recurring: {
                                interval: 'month',
                            },
                        },
                        quantity: 1,
                    },
                ],
                mode: 'subscription',
                success_url: data.successUrl,
                cancel_url: data.cancelUrl,
                metadata: data.metadata,
                subscription_data: {
                    metadata: data.metadata,
                },
            });

            return session;
        } catch (error: any) {
            console.error('Stripe Dynamic Subscription Session Error:', error.message);
            throw new Error('Falha ao criar assinatura mensal');
        }
    },

    async createSplitPaymentSession(data: {
        customerId: string;
        amount: number;
        description: string;
        connectedAccountId: string;
        applicationFeeAmount: number;
        successUrl: string;
        cancelUrl: string;
        metadata?: Record<string, string>;
    }) {
        checkPaymentsEnabled();
        if (IS_PLACEHOLDER) {
            console.log("[STRIPE SIMULATION] Skipping split payment session, redirecting to successUrl.");
            return { url: data.successUrl } as any;
        }
        try {
            const session = await stripe.checkout.sessions.create({
                customer: data.customerId,
                payment_method_types: ['card', 'pix'],
                expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
                line_items: [
                    {
                        price_data: {
                            currency: 'brl',
                            product_data: {
                                name: data.description,
                            },
                            unit_amount: data.amount,
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                payment_intent_data: {
                    application_fee_amount: data.applicationFeeAmount,
                    transfer_data: {
                        destination: data.connectedAccountId,
                    },
                },
                success_url: data.successUrl,
                cancel_url: data.cancelUrl,
                metadata: data.metadata,
            });

            return session;
        } catch (error: any) {
            console.error('Stripe Split Payment Error:', error.message);
            throw new Error('Falha ao criar pagamento compartilhado');
        }
    },

    constructEvent(payload: string | Buffer, sig: string, endpointSecret: string) {
        return stripe.webhooks.constructEvent(payload, sig, endpointSecret);
    },

    async createConnectedAccount(email: string, name: string) {
        checkPaymentsEnabled();
        if (IS_PLACEHOLDER) {
            console.log("[STRIPE SIMULATION] Creating dummy connected account.");
            return { id: `acct_dummy_${Math.random().toString(36).substring(7)}` } as any;
        }
        try {
            const account = await stripe.accounts.create({
                type: 'express',
                email,
                capabilities: {
                    card_payments: { requested: true },
                    transfers: { requested: true },
                },
                business_profile: {
                    name,
                }
            });
            return account;
        } catch (error: any) {
            console.error('Stripe Create Account Error:', error.message);
            throw new Error('Falha ao criar conta conectada no Stripe');
        }
    },

    async createAccountLink(accountId: string, refreshUrl: string, returnUrl: string) {
        checkPaymentsEnabled();
        if (IS_PLACEHOLDER) {
            console.log("[STRIPE SIMULATION] Creating dummy account link.");
            return { url: returnUrl } as any;
        }
        try {
            const accountLink = await stripe.accountLinks.create({
                account: accountId,
                refresh_url: refreshUrl,
                return_url: returnUrl,
                type: 'account_onboarding',
            });
            return accountLink;
        } catch (error: any) {
            console.error('Stripe Account Link Error:', error.message);
            throw new Error('Falha ao gerar link de cadastro Stripe');
        }
    },

    async createPlatformPaymentSession(data: {
        customerId: string;
        amount: number;
        description: string;
        successUrl: string;
        cancelUrl: string;
        metadata?: Record<string, string>;
    }) {
        checkPaymentsEnabled();
        if (IS_PLACEHOLDER) {
            console.log("[STRIPE SIMULATION] Skipping platform payment session, redirecting to successUrl.");
            return { id: `cs_dummy_${Math.random().toString(36).substring(7)}`, url: data.successUrl } as any;
        }
        try {
            const session = await stripe.checkout.sessions.create({
                customer: data.customerId,
                payment_method_types: ['card', 'pix'],
                expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
                line_items: [
                    {
                        price_data: {
                            currency: 'brl',
                            product_data: {
                                name: data.description,
                            },
                            unit_amount: data.amount,
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                success_url: data.successUrl,
                cancel_url: data.cancelUrl,
                metadata: data.metadata,
            });

            return session;
        } catch (error: any) {
            console.error('Stripe Platform Payment Error:', error.message);
            throw new Error('Falha ao criar pagamento direto da plataforma');
        }
    }
};
