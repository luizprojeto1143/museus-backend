import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.MASTER_EMAIL;
  const password = process.env.MASTER_PASSWORD;

  if (!email || !password) {
    console.error("❌ ERRO: MASTER_EMAIL e MASTER_PASSWORD precisam ser definidos nas variáveis de ambiente!");
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  console.log(`Checking user ${email}...`);
  
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      password: hashedPassword,
      role: "MASTER",
      active: true
    },
    create: {
      email,
      name: "Admin Master",
      password: hashedPassword,
      role: "MASTER",
      active: true,
      id: "admin-master-001", updatedAt: new Date()
    }
  });

  console.log("User synced successfully:", user.email);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

