const fs = require('fs');
const path = 'C:\\Users\\luiza\\Documents\\PicWish\\Cultura Viva\\museus-backend\\src\\routes\\stripe.ts';
let content = fs.readFileSync(path, 'utf8');

// For onboarding-link
const oldOnboardingIf = `        if (type === 'MUSEUM') {
            const tenantId = (id as string || user.tenantId) as string;
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
            if (!tenant) return res.status(404).json({ message: 'Museu não encontrado' });
            
            // @ts-ignore
            stripeConnectId = tenant.stripeConnectId || undefined;
            accountName = tenant.name;
            dbUpdate = (newId: string) => prisma.tenant.update({ where: { id: tenant.id }, data: { stripeConnectId: newId } });
        } else {
            // Default: Provider
            const provider = await prisma.accessibilityProvider.findUnique({ where: { userId: user.id } });
            if (!provider) return res.status(404).json({ message: 'Perfil de prestador não encontrado' });
            
            stripeConnectId = provider.stripeConnectId || undefined;
            accountName = provider.name;
            dbUpdate = (newId: string) => prisma.accessibilityProvider.update({ where: { id: provider.id }, data: { stripeConnectId: newId } });
        }`;

const newOnboardingIf = `        if (type === 'MUSEUM') {
            const tenantId = (id as string || user.tenantId) as string;
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
        }`;
content = content.replace(oldOnboardingIf, newOnboardingIf);

const oldReturnUrl = `const returnUrl = type === 'MUSEUM' ? \`\${frontendUrl}/admin/settings?tab=financeiro\` : \`\${frontendUrl}/provider/dashboard?stripe=success\`;`;
const newReturnUrl = `const returnUrl = type === 'MUSEUM' ? \`\${frontendUrl}/admin/settings?tab=financeiro\` : type === 'PRODUCER' ? \`\${frontendUrl}/producer/finance?stripe=success\` : \`\${frontendUrl}/provider/dashboard?stripe=success\`;`;
content = content.replace(oldReturnUrl, newReturnUrl);

// For dashboard-link
const oldDashboardIf = `        if (type === 'MUSEUM') {
            const tenant = await prisma.tenant.findUnique({ where: { id: id as string } });
            connectedId = tenant?.stripeConnectId || '';
        } else {
            const provider = await prisma.accessibilityProvider.findUnique({ where: { userId: req.user!.id } });
            connectedId = provider?.stripeConnectId || '';
        }`;
const newDashboardIf = `        if (type === 'MUSEUM') {
            const tenant = await prisma.tenant.findUnique({ where: { id: id as string } });
            connectedId = tenant?.stripeConnectId || '';
        } else if (type === 'PRODUCER') {
            const producer = await prisma.user.findUnique({ where: { id: req.user!.id } });
            connectedId = producer?.stripeConnectId || '';
        } else {
            const provider = await prisma.accessibilityProvider.findUnique({ where: { userId: req.user!.id } });
            connectedId = provider?.stripeConnectId || '';
        }`;
content = content.replace(oldDashboardIf, newDashboardIf);

// For balance
const oldBalanceIf = `        if (type === 'MUSEUM') {
            const tenant = await prisma.tenant.findUnique({ where: { id: id as string } });
            connectedId = tenant?.stripeConnectId || '';
        } else {
            const provider = await prisma.accessibilityProvider.findUnique({ where: { userId: req.user!.id } });
            connectedId = provider?.stripeConnectId || '';
        }`;
const newBalanceIf = `        if (type === 'MUSEUM') {
            const tenant = await prisma.tenant.findUnique({ where: { id: id as string } });
            connectedId = tenant?.stripeConnectId || '';
        } else if (type === 'PRODUCER') {
            const producer = await prisma.user.findUnique({ where: { id: req.user!.id } });
            connectedId = producer?.stripeConnectId || '';
        } else {
            const provider = await prisma.accessibilityProvider.findUnique({ where: { userId: req.user!.id } });
            connectedId = provider?.stripeConnectId || '';
        }`;
content = content.replace(oldBalanceIf, newBalanceIf);


fs.writeFileSync(path, content, 'utf8');
console.log('Updated stripe.ts');
