const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function check() {
  try {
    const users = await prisma.user.findMany({
      select: {
        email: true,
        role: true,
        name: true
      }
    });
    console.log("DATABASE_USERS_LIST_START");
    console.log(JSON.stringify(users, null, 2));
    console.log("DATABASE_USERS_LIST_END");
  } catch (err) {
    console.error("Error listing users:", err);
  } finally {
    await prisma.$disconnect();
  }
}

check();
