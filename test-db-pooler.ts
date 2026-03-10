import { PrismaClient } from '@prisma/client';

const url = 'postgresql://postgres.qyzvgplfussxtzfbwuyi:luiz%2B1143%2Bcultura@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&connect_timeout=30';

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: url
        }
    }
});

async function test() {
    console.log('Tentando conectar ao POOLER...');
    console.log('URL (mascarada):', url.replace(/:[^:@]+@/, ':****@'));
    try {
        await prisma.$connect();
        console.log('✅ Conexão bem sucedida via Pooler!');
        const result = await prisma.$queryRaw`SELECT 1 as result`;
        console.log('Resultado da query:', result);
    } catch (e) {
        console.error('❌ Erro de conexão no Pooler:', e);
    } finally {
        await prisma.$disconnect();
    }
}

test();
