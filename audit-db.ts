import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("🔍 [Audit] Verificando estrutura das tabelas...");
    try {
        const tables = ['Tenant', 'Work', 'Event'];
        for (const table of tables) {
            console.log(`\n--- Tabela: ${table} ---`);
            const columns: any[] = await prisma.$queryRawUnsafe(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = '${table}'
                ORDER BY column_name;
            `);
            columns.forEach(c => {
                const marker = c.column_name === 'deletedAt' ? '⭐' : '  ';
                console.log(`${marker} ${c.column_name} (${c.data_type})`);
            });
            
            if (!columns.some(c => c.column_name === 'deletedAt')) {
                console.log(`❌ ALERTA: Coluna 'deletedAt' AUSENTE na tabela ${table}`);
            } else {
                console.log(`✅ Sucesso: Coluna 'deletedAt' encontrada na tabela ${table}`);
            }
        }
    } catch (e) {
        console.error("❌ Erro durante a auditoria:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
