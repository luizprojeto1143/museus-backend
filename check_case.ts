import { prisma } from "./src/prisma";

async function main() {
    const emailLower = "culturaviva1143@gmail.com";
    const emailReal = "Culturaviva1143@gmail.com";

    const userLower = await prisma.user.findUnique({ where: { email: emailLower } });

    console.log(`Search '${emailLower}' found: ${!!userLower}`);

    if (userLower) {
        console.log(`Stored email: ${userLower.email}`);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
