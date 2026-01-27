import { prisma } from "./src/prisma";
import bcrypt from "bcrypt";

async function main() {
    const email = "Culturaviva1143@gmail.com";
    const password = "123456";

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
    console.log(`Password '123456' valid? ${isValid}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
