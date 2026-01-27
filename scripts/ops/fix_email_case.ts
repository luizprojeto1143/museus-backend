import { prisma } from "./src/prisma";

async function main() {
    const currentEmail = "Culturaviva1143@gmail.com";
    const newEmail = "culturaviva1143@gmail.com";

    await prisma.user.update({
        where: { email: currentEmail },
        data: { email: newEmail }
    });

    console.log(`Updated email to ${newEmail}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
