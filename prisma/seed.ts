import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
    console.log("🌱 Iniciando seed...");

    // 1. Criar Tenant Padrão (Museu Demo) se não existir
    let tenant = await prisma.tenant.findFirst({
        where: { slug: "museu-demo" }
    });

    if (!tenant) {
        console.log("🏛️ Criando Tenant: Museu de Demonstração...");
        tenant = await prisma.tenant.create({
            data: {
                name: "Museu de Demonstração",
                slug: "museu-demo",
                primaryColor: "#d4af37",
                secondaryColor: "#cd7f32",
                mission: "Demonstrar as funcionalidades do sistema Museus Enterprise."
            }
        });
    } else {
        console.log("✓ Tenant já existe.");
    }

    // 2. Criar Usuário Master se não existir
    const email = "admin@museu.com";
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (!existingUser) {
        console.log("👤 Criando Usuário Master (admin@museu.com)...");
        const hashedPassword = await bcrypt.hash("123456", 10);

        await prisma.user.create({
            data: {
                email,
                name: "Admin Master",
                password: hashedPassword,
                role: Role.MASTER,
                tenantId: tenant.id
            }
        });
        console.log("🔑 Usuário Master criado! Email: admin@museu.com / Senha: 123456");
    } else {
        console.log("✓ Usuário Master já existe.");
    }

    console.log("✅ Seed finalizado!");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
