import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
    console.log("🔍 Verificando usuário Master...");

    const email = "admin@museu.com";

    // Verificar se o usuário já existe
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
        console.log("✓ Usuário Master já existe:");
        console.log(`   ID: ${existingUser.id}`);
        console.log(`   Email: ${existingUser.email}`);
        console.log(`   Role: ${existingUser.role}`);
        console.log(`   TenantId: ${existingUser.tenantId}`);

        // Resetar a senha para garantir que funciona
        const newPassword = await bcrypt.hash("123456", 10);
        await prisma.user.update({
            where: { email },
            data: { password: newPassword }
        });
        console.log("🔑 Senha resetada para: 123456");
    } else {
        console.log("❌ Usuário Master não encontrado. Criando...");

        // Primeiro, verificar/criar tenant demo
        let tenant = await prisma.tenant.findFirst({ where: { slug: "museu-demo" } });

        if (!tenant) {
            console.log("🏛️ Criando Tenant Demo...");
            tenant = await prisma.tenant.create({
                data: {
                    name: "Museu de Demonstração",
                    slug: "museu-demo",
                    primaryColor: "#d4af37",
                    secondaryColor: "#cd7f32"
                }
            });
        }

        const hashedPassword = await bcrypt.hash("123456", 10);

        const user = await prisma.user.create({
            data: {
                email,
                name: "Admin Master",
                password: hashedPassword,
                role: Role.MASTER,
                tenantId: tenant.id
            }
        });

        console.log("✅ Usuário Master criado!");
        console.log(`   ID: ${user.id}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Senha: 123456`);
    }

    // Listar todos os usuários
    console.log("\n📋 Todos os usuários no banco:");
    const allUsers = await prisma.user.findMany({
        select: { id: true, email: true, role: true, tenantId: true }
    });
    console.table(allUsers);
}

main()
    .catch((e) => {
        console.error("❌ Erro:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
