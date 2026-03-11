import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function check() {
  const user = await prisma.user.findUnique({
      where: { email: "admin@museu.com" }
  });
  
  if (!user) {
      console.log("User not found");
      return;
  }
  
  const ok = await bcrypt.compare("123456", user.password);
  console.log("Login check for admin@museu.com / 123456:", ok ? "SUCCESS" : "FAIL");
}

check().finally(() => prisma.$disconnect());
