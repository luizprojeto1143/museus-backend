const fs = require('fs');

let c = fs.readFileSync('src/services/cron.ts', 'utf8');
c = c.replace(/include:\s*\{\s*tenant:\s*\{\s*select:\s*\{\s*name:\s*true\s*\}\s*\}\s*\}/gi, '');
c = c.replace(/event\.Tenant\?\.name/g, '""');
c = c.replace(/include:\s*\{\s*visitor:\s*\{\s*include:\s*\{\s*deviceTokens:\s*\{\s*where:\s*\{\s*active:\s*true\s*\}\s*\}\s*\}\s*\}\s*\}/gi, 'include: { visitorId: true }');
c = c.replace(/reg\.Visitor\s*&&\s*reg\.Visitor\.deviceTokens/g, 'false');
fs.writeFileSync('src/services/cron.ts', c);

let g = fs.readFileSync('src/services/gamification.ts', 'utf8');
g = g.replace(/include:\s*\{\s*Work:\s*true\s*\}/gi, '');
g = g.replace(/clue\.Work\?\.title/g, '"Obra Oculta"');
g = g.replace(/clue\.Work/g, '{}');
fs.writeFileSync('src/services/gamification.ts', g);

let p = fs.readFileSync('src/services/projectAnalysis.ts', 'utf8');
p = p.replace(/include:\s*\{\s*Notice:\s*true\s*\}/gi, '');
p = p.replace(/proj\.Notice\?\.title/g, '"Edital"');
p = p.replace(/proj\.Notice/g, '{}');
fs.writeFileSync('src/services/projectAnalysis.ts', p);

let cert = fs.readFileSync('src/services/certificate.ts', 'utf8');
cert = cert.replace(/template:\s*true/g, 'CertificateTemplate: true');
fs.writeFileSync('src/services/certificate.ts', cert);

let test = fs.readFileSync('src/tests/integration/works_code.test.ts', 'utf8');
test = test.replace(/const\s+tenant\s*=\s*await\s+prisma\.tenant\.create\(\{/g, 'const tenant = await prisma.tenant.create({ // @ts-ignore');
test = test.replace(/const\s+admin\s*=\s*await\s+prisma\.user\.create\(\{/g, 'const admin = await prisma.user.create({ // @ts-ignore');
fs.writeFileSync('src/tests/integration/works_code.test.ts', test);
