import { PrismaClient } from "@prisma/client";

const remoteDbUrl = "postgresql://bancoparamuseu_w0uo_user:VJAj5dHJB5wdFR8STQcQ7fWmFkyGFci4@dpg-d5cgm88gjchc73com8p0-a.oregon-postgres.render.com/bancoparamuseu_w0uo?sslmode=require";

process.env.DATABASE_URL = remoteDbUrl;

const prisma = new PrismaClient();

async function main() {
    console.log("🔍 Verificando banco de dados remoto...");

    try {
        const userCount = await prisma.user.count();
        console.log(`Total de usuários: ${userCount}`);

        const admin = await prisma.user.findUnique({
            where: { email: "admin@museu.com" },
            select: { id: true, email: true, role: true, password: true }
        });

        if (admin) {
            console.log("✅ Usuário admin encontrado:", admin.email);
            console.log("   Role:", admin.role);
            console.log("   Hash da senha:", admin.password.substring(0, 15) + "...");
        } else {
            console.log("❌ Usuário admin@museu.com NÃO encontrado.");
        }

        const tenants = await prisma.tenant.findMany();
        console.log(`Total de Tenants: ${tenants.length}`);
        tenants.forEach(t => console.log(` - ${t.name} (${t.slug})`));

    } catch (error) {
        console.error("Erro ao conectar:", error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
