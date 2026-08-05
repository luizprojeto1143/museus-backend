const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
    const hash = await bcrypt.hash('Museu$2026!', 10);
    const res = await prisma.user.updateMany({
        where: { email: 'admin@museu.com' },
        data: { password: hash }
    });
    console.log('Password reset successfully!', res);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
