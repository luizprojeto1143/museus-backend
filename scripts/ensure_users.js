import { Role } from "@prisma/client";
import bcrypt from "bcrypt";
import { createPrismaClient } from "./prisma_helper.js";

const prisma = createPrismaClient();

async function main() {
    if (process.env.NODE_ENV === "production" && process.env.I_AM_SURE_RESET_PRODUCTION !== "true") {
        console.error("❌ Operação abortada: Scripts de teste/demo são bloqueados em produção por motivos de segurança. Para forçar, defina I_AM_SURE_RESET_PRODUCTION=true.");
        process.exit(1);
    }
    console.log("🛠️ Ensuring demo user accounts...");
    const hashedPassword = await bcrypt.hash(process.env.DEMO_USER_PASSWORD || "123456", 10);
    const tenant = await prisma.tenant.findFirst({ where: { slug: "museu-demo" } });
    
    if (!tenant) {
        console.error("❌ Tenant 'museu-demo' not found. Please run seed first.");
        return;
    }

    const demoEmail = "demo@museu.com";
    await prisma.user.upsert({
        where: { email: demoEmail },
        update: { password: hashedPassword, role: Role.ADMIN, tenantId: tenant.id },
        create: {
            email: demoEmail,
            name: "Admin Demo",
            password: hashedPassword,
            role: Role.ADMIN,
            tenantId: tenant.id
        }
    });

    console.log(`✅ User ${demoEmail} is ready.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
