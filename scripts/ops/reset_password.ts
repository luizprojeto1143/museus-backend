import { prisma } from "./src/prisma";
import bcrypt from "bcrypt";

async function main() {
    if (process.env.NODE_ENV === "production") {
        console.error("❌ Operação abortada: Scripts de teste/demo são bloqueados em produção por motivos de segurança.");
        process.exit(1);
    }
    const email = "Culturaviva1143@gmail.com";
    const newPass = process.env.RESET_USER_PASSWORD || "123456";
    const hash = await bcrypt.hash(newPass, 10);

    await prisma.user.update({
        where: { email },
        data: { password: hash }
    });

    console.log(`Password for ${email} reset to ${newPass}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
