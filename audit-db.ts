import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("🔍 [Audit] Verificando estrutura das tabelas...");
  const tables = ['Tenant', 'Work', 'Event', 'Visitor', 'VisitorVisit', 'Achievement', 'PassportStamp', 'VisitorAchievement', 'VisitorSkin'];

  for (const table of tables) {
    console.log(`\n📊 Auditando tabela: ${table}`);
    try {
      const columns: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = '${table}'
        ORDER BY column_name;
      `);
      
      if (columns.length === 0) {
        console.log(`❌ Tabela '${table}' não encontrada ou sem colunas.`);
      } else {
        columns.forEach(c => console.log(`  - ${c.column_name} (${c.data_type})`));
      }
    } catch (e: any) {
      console.log(`❌ Erro ao auditar ${table}: ${e.message}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
