import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const email = "admin@museu.com";
  const password = "123456";
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
      active: true
    }
  });

  console.log("User synced successfully:", user.email);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
