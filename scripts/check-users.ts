import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function check() {
  const users = await prisma.user.findMany({
      include: { tenant: true }
  });
  console.log("Users in DB:", users.map(u => ({ email: u.email, role: u.role, tenant: u.tenant ? u.tenant.name : "null" })));
}

check().finally(() => prisma.$disconnect());
