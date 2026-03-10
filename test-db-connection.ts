import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const url = (process.env.DATABASE_URL || '').replace('postgres.qyzvgplfussxtzfbwuyi', 'postgres');

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: url
        }
    }
});

async function test() {
    console.log('Tentando conectar ao banco...');
    console.log('URL (mascarada):', url.replace(/:[^:@]+@/, ':****@'));
    try {
        await prisma.$connect();
        console.log('✅ Conexão bem sucedida!');
        const result = await prisma.$queryRaw`SELECT 1 as result`;
        console.log('Resultado da query:', result);
    } catch (e) {
        console.error('❌ Erro de conexão:', e);
    } finally {
        await prisma.$disconnect();
    }
}

test();
