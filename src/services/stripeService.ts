import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

if (!STRIPE_SECRET_KEY) {
    console.warn("⚠️ STRIPE_SECRET_KEY not configured. Payments will fail.");
}

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2025-01-27' as any, // Updated to latest stable for current SDK
});

interface CustomerData {
    name: string;
    email: string;
    userId: string;
    metadata?: Record<string, string>;
}

export const stripeService = {
    /**
     * Creates or retrieves a customer in Stripe
     */
    async createCustomer(data: CustomerData) {
        try {
            // Search by email first
            const customers = await stripe.customers.list({
                email: data.email,
                limit: 1
            });

            if (customers.data.length > 0) {
                return customers.data[0].id;
            }

            // Create new customer
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

    /**
     * Creates a Checkout Session for Subscriptions (R$ 50/month)
     */
    async createSubscriptionSession(customerId: string, priceId: string, successUrl: string, cancelUrl: string) {
        try {
            const session = await stripe.checkout.sessions.create({
                customer: customerId,
                payment_method_types: ['card'],
                line_items: [
                    {
                        price: priceId, // You should create this price in Stripe dashboard
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
            throw new Error('Falha ao criar sessão de assinatura');
        }
    },

    /**
     * Creates a Checkout Session for one-off payments with Split (Connect)
     */
    async createSplitPaymentSession(data: {
        customerId: string;
        amount: number; // in cents (e.g., 1000 for R$ 10.00)
        description: string;
        connectedAccountId: string; // The Provider's Stripe Account ID
        applicationFeeAmount: number; // Your fee in cents
        successUrl: string;
        cancelUrl: string;
    }) {
        try {
            const session = await stripe.checkout.sessions.create({
                customer: data.customerId,
                payment_method_types: ['card', 'pix'],
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
            });

            return session;
        } catch (error: any) {
            console.error('Stripe Split Payment Error:', error.message);
            throw new Error('Falha ao criar pagamento compartilhado');
        }
    },

    /**
     * Constructs the webhook event
     */
    constructEvent(payload: string | Buffer, sig: string, endpointSecret: string) {
        return stripe.webhooks.constructEvent(payload, sig, endpointSecret);
    },

    /**
     * Creates a new Connected Account (Express)
     */
    async createConnectedAccount(email: string, name: string) {
        try {
            const account = await stripe.accounts.create({
                type: 'express',
                email: email,
                capabilities: {
                    card_payments: { requested: true },
                    transfers: { requested: true },
                },
                business_profile: {
                    name: name,
                }
            });
            return account;
        } catch (error: any) {
            console.error('Stripe Create Account Error:', error.message);
            throw new Error('Falha ao criar conta conectada no Stripe');
        }
    },

    /**
     * Creates an Account Link for Onboarding
     */
    async createAccountLink(accountId: string, refreshUrl: string, returnUrl: string) {
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
    }
};
