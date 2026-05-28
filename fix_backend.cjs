const fs = require('fs');
const path = require('path');

const basePath = 'C:\\Users\\luiza\\Documents\\PicWish\\Cultura Viva\\museus-backend';

// 1. Fix src/index.ts
let indexContent = fs.readFileSync(path.join(basePath, 'src', 'index.ts'), 'utf8');
indexContent = indexContent.replace('import authRoutes from "./routes/auth.js";\r\nimport sponsorPortalRoutes from "./routes/sponsor-portal.js";\r\n\r\napp.use("/auth", authRoutes);', 'import sponsorPortalRoutes from "./routes/sponsor-portal.js";');
indexContent = indexContent.replace('import authRoutes from "./routes/auth.js";\nimport sponsorPortalRoutes from "./routes/sponsor-portal.js";\n\napp.use("/auth", authRoutes);', 'import sponsorPortalRoutes from "./routes/sponsor-portal.js";');
fs.writeFileSync(path.join(basePath, 'src', 'index.ts'), indexContent, 'utf8');
console.log('Fixed src/index.ts');

// 2. Fix src/routes/events.ts
let eventsContent = fs.readFileSync(path.join(basePath, 'src', 'routes', 'events.ts'), 'utf8');
eventsContent = eventsContent.replace('        producerId: user.role === "PRODUCER" ? user.id : undefined,\r\n', '');
eventsContent = eventsContent.replace('        producerId: user.role === "PRODUCER" ? user.id : undefined,\n', '');
fs.writeFileSync(path.join(basePath, 'src', 'routes', 'events.ts'), eventsContent, 'utf8');
console.log('Fixed src/routes/events.ts');

// 3. Fix schema.prisma
let schemaContent = fs.readFileSync(path.join(basePath, 'prisma', 'schema.prisma'), 'utf8');
const projectFieldsToAdd = `  notaFiscalUrl        String?
  notaFiscalNumber     String?
  notaFiscalDate       DateTime?`;
if (!schemaContent.includes('notaFiscalUrl')) {
    schemaContent = schemaContent.replace('  socialMediaLinks Json?', `  socialMediaLinks Json?\n\n${projectFieldsToAdd}`);
    fs.writeFileSync(path.join(basePath, 'prisma', 'schema.prisma'), schemaContent, 'utf8');
    console.log('Fixed schema.prisma');
} else {
    console.log('schema.prisma already fixed');
}

// 4. Fix src/routes/stripe.ts
let stripeContent = fs.readFileSync(path.join(basePath, 'src', 'routes', 'stripe.ts'), 'utf8');
stripeContent = stripeContent.replace('const balance = await stripe.balance.retrieve({ stripeAccount: connectedId });', 'const balance = await stripe.balance.retrieve({}, { stripeAccount: connectedId });');
fs.writeFileSync(path.join(basePath, 'src', 'routes', 'stripe.ts'), stripeContent, 'utf8');
console.log('Fixed src/routes/stripe.ts');
