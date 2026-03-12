import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function testLogin() {
    const email = 'admin@museu.com';
    const password = 'admin123';
    
    console.log(`🔍 [Test] Tentando localizar usuário: ${email}`);
    try {
        const user = await prisma.user.findUnique({
            where: { email },
            include: {
                tenant: { select: { name: true } }
            }
        });

        if (!user) {
            console.log("❌ Usuário não encontrado.");
            return;
        }

        console.log(`✅ Usuário encontrado: ${user.name} (Tenant: ${user.tenant?.name || 'N/A'})`);
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            console.log("✅ Senha correta!");
            
            // Tenta criar um registro qualquer para testar escrita
            console.log("📡 Testando escrita no banco...");
            const tempLog = await (prisma as any).auditLog.create({
                data: {
                    action: 'LOGIN_TEST',
                    details: 'Teste de conectividade via script',
                    tenantId: user.tenantId
                }
            });
            console.log("✅ Escrita realizada com sucesso! ID:", tempLog.id);
            
        } else {
            console.log("❌ Senha incorreta.");
        }
    } catch (e) {
        console.error("❌ Erro fatal no login test:", e);
    } finally {
        await prisma.$disconnect();
    }
}

testLogin();
