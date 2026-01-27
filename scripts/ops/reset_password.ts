import { prisma } from "./src/prisma";
import bcrypt from "bcrypt";

async function main() {
    const email = "Culturaviva1143@gmail.com";
    const newPass = "123456";
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
