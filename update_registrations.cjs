const fs = require('fs');
const path = 'C:\\Users\\luiza\\Documents\\PicWish\\Cultura Viva\\museus-backend\\src\\routes\\registrations.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace('include: { event: { select: { tenantId: true } } }', 'include: { event: { select: { tenantId: true, producerId: true } } }');

const oldStripeLogic = `                // Fetch Tenant Stripe Connect ID
                const tenant = await prisma.tenant.findUnique({
                    where: { id: tenantId },
                    select: { stripeConnectId: true, name: true }
                });

                if (!tenant?.stripeConnectId) {
                    return res.status(400).json({ 
                        error: 'Este museu ainda não configurou os recebimentos via Stripe Connect. Entre em contato com a administração.' 
                    });
                }

                // Get/Create Stripe Customer
                const stripeCustomerId = await stripeService.createCustomer({
                    name: guestName,
                    email: guestEmail,
                    userId: visitorId || req.user?.id || 'guest'
                });

                const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
                const amountCents = Math.round(Number(ticket.price) * 100);
                const platformFeeCents = Math.round(amountCents * 0.05); // 5% platform fee

                // Create Checkout Session with Split
                const session = await stripeService.createSplitPaymentSession({
                    customerId: stripeCustomerId,
                    amount: amountCents,
                    description: \`Ingresso: \${ticket.name} - \${tenant?.name || 'Evento'}\`,
                    connectedAccountId: tenant?.stripeConnectId || '', 
                    applicationFeeAmount: platformFeeCents,
                    successUrl: \`\${frontendUrl}/tickets/success?code=\${code}\`,
                    cancelUrl: \`\${frontendUrl}/tickets/cancel?code=\${code}\`
                });`;

const newStripeLogic = `                let connectedAccountId = '';
                let payeeName = 'Evento';
                
                if (ticket.event.producerId) {
                    const producer = await prisma.user.findUnique({
                        where: { id: ticket.event.producerId },
                        select: { stripeConnectId: true, name: true }
                    });
                    if (producer?.stripeConnectId) {
                        connectedAccountId = producer.stripeConnectId;
                        payeeName = producer.name;
                    }
                }
                
                // Fallback to Tenant if producer has no connect ID or event is not from a producer
                if (!connectedAccountId) {
                    const tenant = await prisma.tenant.findUnique({
                        where: { id: tenantId },
                        select: { stripeConnectId: true, name: true }
                    });
                    if (tenant?.stripeConnectId) {
                        connectedAccountId = tenant.stripeConnectId;
                        payeeName = tenant.name;
                    }
                }

                if (!connectedAccountId) {
                    return res.status(400).json({ 
                        error: 'O recebedor deste evento ainda não configurou pagamentos via Stripe Connect. Entre em contato com a administração.' 
                    });
                }

                // Get/Create Stripe Customer
                const stripeCustomerId = await stripeService.createCustomer({
                    name: guestName,
                    email: guestEmail,
                    userId: visitorId || req.user?.id || 'guest'
                });

                const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
                const amountCents = Math.round(Number(ticket.price) * 100);
                const platformFeeCents = Math.round(amountCents * 0.05); // 5% platform fee

                // Create Checkout Session with Split
                const session = await stripeService.createSplitPaymentSession({
                    customerId: stripeCustomerId,
                    amount: amountCents,
                    description: \`Ingresso: \${ticket.name} - \${payeeName}\`,
                    connectedAccountId, 
                    applicationFeeAmount: platformFeeCents,
                    successUrl: \`\${frontendUrl}/tickets/success?code=\${code}\`,
                    cancelUrl: \`\${frontendUrl}/tickets/cancel?code=\${code}\`
                });`;

content = content.replace(oldStripeLogic, newStripeLogic);

fs.writeFileSync(path, content, 'utf8');
console.log('Updated registrations.ts');
