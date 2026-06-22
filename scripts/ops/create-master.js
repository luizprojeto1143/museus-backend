import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createMasterUser() {
  try {
    const email = process.env.MASTER_EMAIL;
    const password = process.env.MASTER_PASSWORD;
    const name = 'Master Admin';

    if (!email || !password) {
      console.error("❌ ERRO: MASTER_EMAIL e MASTER_PASSWORD precisam ser definidos nas variáveis de ambiente!");
      process.exit(1);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'MASTER',
        tenantId: null
      }
    });

    console.log('✅ Usuário master criado com sucesso!');
    console.log('Email:', email);
    console.log('ID:', user.id);

  } catch (error) {
    if (error.code === 'P2002') {
      const email = process.env.MASTER_EMAIL;
      const password = process.env.MASTER_PASSWORD;
      console.log('⚠️ Usuário já existe. Atualizando senha...');

      const hashedPassword = await bcrypt.hash(password, 10);

      await prisma.user.update({
        where: { email },
        data: {
          password: hashedPassword,
          role: 'MASTER',
          name: 'Master Admin'
        }
      });

      console.log('✅ Senha atualizada com sucesso!');
      console.log('Email:', email);
    } else {
      console.error('❌ Erro:', error.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

createMasterUser();
