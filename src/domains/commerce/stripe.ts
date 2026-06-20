import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware } from '../../middleware/auth.js';
import { stripeService, stripe } from '../../services/stripeService.js';

const router = Router();

/**
 * GET /stripe/onboarding-link
 * Generates a link for the provider to complete their Stripe Connect setup
 */
router.get('/onboarding-link', authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const { type, id } = req.query; // type: 'PROVIDER' | 'MUSEUM'
        
        let stripeConnectId: string | undefined = undefined;
        let accountName = '';
        let dbUpdate: any = null;

        if (type === 'MUSEUM') {
            let tenantId = user.tenantId;
            if (id && id !== user.tenantId) {
                if (user.role !== 'MASTER') {
                    return res.status(403).json({ message: 'Acesso negado. Você só pode gerenciar o financeiro do seu próprio museu.' });
                }
                tenantId = id as string;
            }
            if (!tenantId) return res.status(400).json({ message: 'Tenant ID não encontrado' });
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
            if (!tenant) return res.status(404).json({ message: 'Museu não encontrado' });
            
            stripeConnectId = tenant.stripeConnectId || undefined;
            accountName = tenant.name;
            dbUpdate = (newId: string) => prisma.tenant.update({ where: { id: tenant.id }, data: { stripeConnectId: newId } });
        } else if (type === 'PRODUCER') {
            const producer = await prisma.user.findUnique({ where: { id: user.id } });
            if (!producer) return res.status(404).json({ message: 'Produtor não encontrado' });
            
            stripeConnectId = producer.stripeConnectId || undefined;
            accountName = producer.name;
            dbUpdate = (newId: string) => prisma.user.update({ where: { id: producer.id }, data: { stripeConnectId: newId } });
        } else {
            // Default: Provider
            const provider = await prisma.accessibilityProvider.findUnique({ where: { userId: user.id } });
            if (!provider) return res.status(404).json({ message: 'Perfil de prestador não encontrado' });
            
            stripeConnectId = provider.stripeConnectId || undefined;
            accountName = provider.name;
            dbUpdate = (newId: string) => prisma.accessibilityProvider.update({ where: { id: provider.id }, data: { stripeConnectId: newId } });
        }

        // If no Connect ID yet, create one
        if (!stripeConnectId) {
            const account = await stripeService.createConnectedAccount(user.email, accountName);
            stripeConnectId = account.id;

            // Update DB with the new Connect ID
            await dbUpdate(stripeConnectId);
        }

        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        const returnUrl = type === 'MUSEUM' ? `${frontendUrl}/admin/settings?tab=financeiro` : type === 'PRODUCER' ? `${frontendUrl}/producer/finance?stripe=success` : `${frontendUrl}/provider/dashboard?stripe=success`;
        
        // Generate Onboarding Link
        const accountLink = await stripeService.createAccountLink(
            stripeConnectId as string,
            `${frontendUrl}/dashboard?stripe=refresh`, // Refresh URL
            returnUrl
        );

        res.json({ url: accountLink.url });

    } catch (error: any) {
        console.error('Onboarding Link Error:', error);
        res.status(500).json({ message: 'Erro ao gerar link de configuração de pagamentos' });
    }
});

/**
 * GET /stripe/dashboard-link
 * Generates a login link for the provider to see their Stripe Express Dashboard (Balance, Payouts)
 */
router.get('/dashboard-link', authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const { type, id } = req.query;
        let connectedId = '';

        if (type === 'MUSEUM') {
            let tenantId = user.tenantId;
            if (id && id !== user.tenantId) {
                if (user.role !== 'MASTER') {
                    return res.status(403).json({ message: 'Acesso negado.' });
                }
                tenantId = id as string;
            }
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId as string } });
            connectedId = tenant?.stripeConnectId || '';
        } else if (type === 'PRODUCER') {
            const producer = await prisma.user.findUnique({ where: { id: req.user!.id } });
            connectedId = producer?.stripeConnectId || '';
        } else {
            const provider = await prisma.accessibilityProvider.findUnique({ where: { userId: req.user!.id } });
            connectedId = provider?.stripeConnectId || '';
        }

        if (!connectedId) {
            return res.status(400).json({ message: 'Configuração de pagamentos pendente' });
        }

        // Handle Simulation Mode
        if (connectedId.startsWith('acct_dummy_')) {
            console.log("💳 [STRIPE SIMULATION] Generating dummy dashboard link.");
            return res.json({ url: "https://dashboard.stripe.com/test/dashboard" });
        }

        // Generate Login Link (Express Dashboard)
        const loginLink = await stripe.accounts.createLoginLink(connectedId);
        
        res.json({ url: loginLink.url });

    } catch (error) {
        console.error('Dashboard Link Error:', error);
        res.status(500).json({ message: 'Erro ao gerar link do painel financeiro' });
    }
});

/**
 * GET /stripe/balance
 * Returns the current balance of the connected account
 */
router.get('/balance', authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const { type, id } = req.query;
        let connectedId = '';

        if (type === 'MUSEUM') {
            let tenantId = user.tenantId;
            if (id && id !== user.tenantId) {
                if (user.role !== 'MASTER') {
                    return res.status(403).json({ message: 'Acesso negado.' });
                }
                tenantId = id as string;
            }
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId as string } });
            connectedId = tenant?.stripeConnectId || '';
        } else if (type === 'PRODUCER') {
            const producer = await prisma.user.findUnique({ where: { id: req.user!.id } });
            connectedId = producer?.stripeConnectId || '';
        } else {
            const provider = await prisma.accessibilityProvider.findUnique({ where: { userId: req.user!.id } });
            connectedId = provider?.stripeConnectId || '';
        }

        if (!connectedId) {
            return res.json({ available: 0, pending: 0 });
        }

        if (connectedId.startsWith('acct_dummy_')) {
            return res.json({ available: 150000, pending: 50000 }); // R$ 1500,00 available, R$ 500,00 pending simulation
        }

        const balance = await stripe.balance.retrieve({}, { stripeAccount: connectedId });
        
        const available = balance.available.reduce((acc, curr) => acc + curr.amount, 0);
        const pending = balance.pending.reduce((acc, curr) => acc + curr.amount, 0);

        res.json({ available, pending });

    } catch (error) {
        console.error('Balance Error:', error);
        res.status(500).json({ message: 'Erro ao consultar saldo' });
    }
});

/**
 * POST /stripe/payout
 * Realiza a transferência de saques (payout) de uma conta conectada Express (real ou simulada) para seu banco vinculado.
 */
router.post('/payout', authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const { type, id } = req.query; // type: 'PRODUCER' | 'MUSEUM' | 'PROVIDER'
        
        let connectedId = '';
        if (type === 'MUSEUM') {
            let tenantId = user.tenantId;
            if (id && id !== user.tenantId) {
                if (user.role !== 'MASTER') {
                    return res.status(403).json({ message: 'Acesso negado.' });
                }
                tenantId = id as string;
            }
            if (!tenantId) return res.status(400).json({ message: 'Tenant ID não encontrado' });
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
            connectedId = tenant?.stripeConnectId || '';
        } else if (type === 'PRODUCER') {
            const producer = await prisma.user.findUnique({ where: { id: user.id } });
            connectedId = producer?.stripeConnectId || '';
        } else {
            const provider = await prisma.accessibilityProvider.findUnique({ where: { userId: user.id } });
            connectedId = provider?.stripeConnectId || '';
        }

        if (!connectedId) {
            return res.status(400).json({ message: 'Conta de recebimentos Stripe não configurada.' });
        }

        // Simulação
        if (connectedId.startsWith('acct_dummy_')) {
            console.log(`💳 [STRIPE SIMULATION] Payout de saque simulado com sucesso para ${connectedId}`);
            return res.json({ 
                success: true, 
                message: 'Saque simulado processado com sucesso! Em ambiente real, os fundos estarão em sua conta bancária em até 24h.' 
            });
        }

        // Real
        const balance = await stripe.balance.retrieve({}, { stripeAccount: connectedId });
        const availableBrl = balance.available.find(b => b.currency === 'brl');
        const availableAmount = availableBrl ? availableBrl.amount : 0;

        if (availableAmount <= 0) {
            return res.status(400).json({ message: 'Não há saldo disponível suficiente para saque no momento.' });
        }

        const payout = await stripe.payouts.create(
            {
                amount: availableAmount,
                currency: 'brl',
            },
            {
                stripeAccount: connectedId,
            }
        );

        res.json({
            success: true,
            message: 'Saque manual solicitado com sucesso! Os fundos foram enviados para sua conta cadastrada.',
            payoutId: payout.id,
            amount: availableAmount
        });

    } catch (error: any) {
        console.error('Payout Error:', error);
        res.status(500).json({ message: error.message || 'Erro ao processar a transferência do saldo' });
    }
});

export const stripeRouter = router;
