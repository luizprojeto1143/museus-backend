import { prisma } from "./src/prisma";
import bcrypt from "bcrypt";

async function main() {
    if (process.env.NODE_ENV === "production" && process.env.I_AM_SURE_RESET_PRODUCTION !== "true") {
        console.error("❌ Operação abortada: Scripts de teste/demo são bloqueados em produção por motivos de segurança. Para forçar, defina I_AM_SURE_RESET_PRODUCTION=true.");
        process.exit(1);
    }
    const email = "Culturaviva1143@gmail.com";
    const password = process.env.DEMO_USER_PASSWORD || "123456";

    const user = await prisma.user.findUnique({
        where: { email }
    });

    if (!user) {
        console.log("User not found!");
        return;
    }

    const isValid = await bcrypt.compare(password, user.password);
    console.log(`User: ${user.email}`);
    console.log(`Role: ${user.role}`);
    console.log(`Active: ${user.active}`);
    console.log(`Password valid? ${isValid}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
