import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { stripeService } from '../services/stripeService.js';
import { PlatformFeeSource } from '@prisma/client';
import { getPlatformFee } from '../services/fee.service.js';
import { sendOk } from '../utils/apiResponse.js';
import { deliverTenantWebhooks } from '../services/outboundWebhook.service.js';

const router = Router();

const STATE_TO_REGION: Record<string, string> = {
    AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
    AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste", PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
    DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
    ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
    PR: "Sul", RS: "Sul", SC: "Sul"
};

function normalizeBenefits(benefits: unknown): string[] {
    if (Array.isArray(benefits)) return benefits.map(String).filter(Boolean);
    if (typeof benefits === "string") return benefits.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);
    if (benefits && typeof benefits === "object") return Object.values(benefits as Record<string, unknown>).map(String).filter(Boolean);
    return [];
}

// GET /memberships/plans — List plans (public)
router.get('/plans', async (req, res) => {
    try {
        const tenantId = req.query.tenantId as string;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const plans = await prisma.membershipPlan.findMany({
            where: { tenantId, active: true },
            include: { _count: { select: { memberships: true } } },
            orderBy: { monthlyPrice: 'asc' }
        });
        res.json(plans);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar planos' });
    }
});

// GET /memberships/benefits/national - Public national benefits club feed
router.get('/benefits/national', async (req, res) => {
    try {
        const state = typeof req.query.state === "string" ? req.query.state.toUpperCase() : undefined;
        const region = typeof req.query.region === "string" ? req.query.region : undefined;
        const city = typeof req.query.city === "string" ? req.query.city.toLowerCase() : undefined;

        const plans = await prisma.membershipPlan.findMany({
            where: { active: true },
            orderBy: [{ monthlyPrice: "asc" }, { createdAt: "desc" }],
            take: 200,
            include: { _count: { select: { memberships: true } } }
        });

        const tenantIds = Array.from(new Set(plans.map(plan => plan.tenantId)));
        const [tenants, equipments] = await Promise.all([
            prisma.tenant.findMany({
                where: { id: { in: tenantIds }, deletedAt: null },
                select: { id: true, name: true, slug: true, logoUrl: true, coverImageUrl: true }
            }),
            prisma.equipamentoCultural.findMany({
                where: { tenantId: { in: tenantIds }, ativo: true },
                select: { tenantId: true, nome: true, slug: true, cidade: true, estado: true, fotoCapaUrl: true, logoUrl: true }
            })
        ]);

        const tenantsById = new Map(tenants.map(tenant => [tenant.id, tenant]));
        const equipmentByTenant = new Map(equipments.map(equipment => [equipment.tenantId, equipment]));
        const items = plans
            .map(plan => {
                const tenant = tenantsById.get(plan.tenantId);
                const equipment = equipmentByTenant.get(plan.tenantId);
                const planState = equipment?.estado?.toUpperCase();
                const planRegion = planState ? STATE_TO_REGION[planState] || "Outros" : "Outros";

                return {
                    id: plan.id,
                    tenantId: plan.tenantId,
                    tenantName: tenant?.name || equipment?.nome || "Instituicao cultural",
                    tenantSlug: tenant?.slug,
                    equipmentName: equipment?.nome,
                    equipmentSlug: equipment?.slug,
                    city: equipment?.cidade,
                    state: planState,
                    region: planRegion,
                    name: plan.name,
                    description: plan.description,
                    monthlyPrice: Number(plan.monthlyPrice),
                    yearlyPrice: plan.yearlyPrice ? Number(plan.yearlyPrice) : null,
                    benefits: normalizeBenefits(plan.benefits),
                    badgeCode: plan.badgeCode,
                    shopDiscount: plan.shopDiscount,
                    subscribers: plan._count.memberships,
                    imageUrl: equipment?.fotoCapaUrl || tenant?.coverImageUrl || tenant?.logoUrl || equipment?.logoUrl
                };
            })
            .filter(item => !state || item.state === state)
            .filter(item => !region || item.region.toLowerCase() === region.toLowerCase())
            .filter(item => !city || item.city?.toLowerCase().includes(city));

        const summary = {
            totalPlans: items.length,
            totalSubscribers: items.reduce((sum, item) => sum + item.subscribers, 0),
            states: Array.from(new Set(items.map(item => item.state).filter(Boolean))).length,
            freePlans: items.filter(item => item.monthlyPrice === 0).length
        };

        return sendOk(res, items, { summary });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar beneficios nacionais' });
    }
});

// GET /memberships/me/card - Visitor digital membership card
router.get('/me/card', authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const visitorEmail = user.email.toLowerCase();
        const memberships = await prisma.membership.findMany({
            where: { visitorEmail, status: { in: ["ACTIVE", "PENDING"] } },
            include: { membershipPlan: true },
            orderBy: { createdAt: "desc" }
        });

        const tenantIds = Array.from(new Set(memberships.map(membership => membership.tenantId)));
        const [tenants, equipments] = await Promise.all([
            prisma.tenant.findMany({
                where: { id: { in: tenantIds } },
                select: { id: true, name: true, slug: true, logoUrl: true, primaryColor: true }
            }),
            prisma.equipamentoCultural.findMany({
                where: { tenantId: { in: tenantIds }, ativo: true },
                select: { tenantId: true, nome: true, cidade: true, estado: true }
            })
        ]);

        const tenantsById = new Map(tenants.map(tenant => [tenant.id, tenant]));
        const equipmentByTenant = new Map(equipments.map(equipment => [equipment.tenantId, equipment]));
        const cards = memberships.map(membership => {
            const tenant = tenantsById.get(membership.tenantId);
            const equipment = equipmentByTenant.get(membership.tenantId);
            const verificationCode = Buffer.from(`${membership.id}:${visitorEmail}`).toString("base64url");

            return {
                id: membership.id,
                holderName: membership.visitorName || user.name || visitorEmail,
                holderEmail: visitorEmail,
                status: membership.status,
                validUntil: membership.renewDate,
                startedAt: membership.startDate,
                plan: {
                    id: membership.membershipPlan.id,
                    name: membership.membershipPlan.name,
                    benefits: normalizeBenefits(membership.membershipPlan.benefits),
                    badgeCode: membership.membershipPlan.badgeCode,
                    shopDiscount: membership.membershipPlan.shopDiscount
                },
                tenant: {
                    id: membership.tenantId,
                    name: tenant?.name || equipment?.nome || "Instituicao cultural",
                    slug: tenant?.slug,
                    logoUrl: tenant?.logoUrl,
                    primaryColor: tenant?.primaryColor,
                    city: equipment?.cidade,
                    state: equipment?.estado
                },
                wallet: {
                    passReady: false,
                    googleWalletReady: false,
                    qrPayload: `cultura-viva:membership:${verificationCode}`,
                    verificationCode,
                    note: "Apple Wallet e Google Wallet dependem de certificados/issuer keys configurados em homologacao."
                }
            };
        });

        return sendOk(res, { cards, activeCards: cards.filter(card => card.status === "ACTIVE").length });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar cartao de assinante' });
    }
});

// POST /memberships/plans — Create plan (admin)
router.post('/plans', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = req.user!.role === 'MASTER' ? (req.body.tenantId || req.query.tenantId) : req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const { name, description, monthlyPrice, yearlyPrice, benefits, badgeCode, shopDiscount } = req.body;
        const plan = await prisma.membershipPlan.create({
            data: { name, description, monthlyPrice, yearlyPrice, benefits, badgeCode, shopDiscount, tenantId }
        });
        res.status(201).json(plan);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar plano' });
    }
});

// GET /memberships — List memberships (admin)
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.user!.role === 'MASTER' && req.query.tenantId) ? (req.query.tenantId as string) : req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const memberships = await prisma.membership.findMany({
            where: { tenantId },
            include: { membershipPlan: { select: { name: true, monthlyPrice: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json(memberships);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar assinantes' });
    }
});

// POST /memberships — Subscribe (visitor)
router.post('/', authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const { planId, visitorName } = req.body;
        if (!planId) return res.status(400).json({ message: 'Dados incompletos' });

        const plan = await prisma.membershipPlan.findUnique({ where: { id: planId } });
        if (!plan) return res.status(404).json({ message: 'Plano não encontrado' });
        const tenantId = plan.tenantId;
        const visitorEmail = user.email.toLowerCase();
        const subscriberName = visitorName || user.name || "Assinante";

        const isPaid = Number(plan.monthlyPrice) > 0;
        const existing = await prisma.membership.findFirst({
            where: { planId, visitorEmail, tenantId, status: { in: ["ACTIVE", "PENDING"] } }
        });
        if (existing) return res.status(409).json({ message: 'Assinatura ja existe para este plano' });

        if (isPaid) {
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
            if (!tenant?.stripeConnectId) {
                return res.status(400).json({ message: "Inquilino não configurado para pagamentos via Stripe Connect." });
            }
        }

        const membership = await prisma.membership.create({
            data: { 
                planId, 
                visitorEmail, 
                visitorName: subscriberName, 
                tenantId, 
                status: isPaid ? "PENDING" : "ACTIVE",
                renewDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) 
            }
        });

        if (isPaid) {
            const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
            const stripeConnectId = tenant?.stripeConnectId;

            if (!stripeConnectId) {
                return res.status(400).json({ message: "Inquilino não configurado para pagamentos via Stripe Connect." });
            }

            const amountInCents = Math.round(Number(plan.monthlyPrice) * 100);

            // Sprint 15: Calcular taxa via Central de Taxas (MEMBERSHIP)
            const feeResult = await getPlatformFee({
                tenantId,
                sourceType: PlatformFeeSource.MEMBERSHIP,
                amountCents: amountInCents
            });
            const appFeeInCents = feeResult.platformFeeCents;

            const customerId = await stripeService.createCustomer({
                name: subscriberName,
                email: visitorEmail,
                userId: user.id
            });

            const session = await stripeService.createSplitPaymentSession({
                customerId,
                amount: feeResult.buyerPaysCents, // BUYER paga base + taxa
                description: `Assinatura Plano: ${plan.name}`,
                connectedAccountId: stripeConnectId,
                applicationFeeAmount: appFeeInCents,
                successUrl: `${frontendUrl}/club-membership?success=true`,
                cancelUrl: `${frontendUrl}/club-membership?canceled=true`,
                metadata: {
                    membershipId: membership.id,
                    tenantId
                }
            });

            await prisma.membership.update({
                where: { id: membership.id },
                data: { 
                    paymentId: session.id,
                    // Sprint 15 — fee snapshot
                    feeConfigId: feeResult.configId,
                    platformFeePercent: feeResult.percentage,
                    platformFeeAmountCents: appFeeInCents
                }
            });

            return res.status(201).json({
                message: "Assinatura pendente de pagamento",
                membership,
                checkoutUrl: session.url
            });
        }

        deliverTenantWebhooks(tenantId, "membership.activated", {
            membershipId: membership.id,
            planId: plan.id,
            planName: plan.name,
            visitorEmail,
            visitorName: subscriberName,
            status: membership.status
        }).catch(err => console.error("Membership webhook delivery failed:", err));

        res.status(201).json(membership);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar assinatura' });
    }
});

// GET /memberships/stats — Stats (admin)
router.get('/stats', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.user!.role === 'MASTER' && req.query.tenantId) ? (req.query.tenantId as string) : req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const [active, total, plans] = await Promise.all([
            prisma.membership.count({ where: { tenantId, status: 'ACTIVE' } }),
            prisma.membership.count({ where: { tenantId } }),
            prisma.membershipPlan.findMany({ where: { tenantId }, include: { _count: { select: { memberships: true } } } })
        ]);
        const revenue = plans.reduce((sum, p) => sum + (Number(p.monthlyPrice) * p._count.memberships), 0);
        res.json({ active, total, mrr: revenue, plans });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar stats' });
    }
});

export default router;
