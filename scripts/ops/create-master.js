import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createMasterUser() {
  try {
    const email = 'Culturaviva1143@gmail.com';
    const password = 'Museu1143';
    const name = 'Master Admin';

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
    console.log('Senha:', password);
    console.log('ID:', user.id);

  } catch (error) {
    if (error.code === 'P2002') {
      console.log('⚠️ Usuário já existe. Atualizando senha...');

      const hashedPassword = await bcrypt.hash('Museu1143', 10);

      await prisma.user.update({
        where: { email: 'Culturaviva1143@gmail.com' },
        data: {
          password: hashedPassword,
          role: 'MASTER',
          name: 'Master Admin'
        }
      });

      console.log('✅ Senha atualizada com sucesso!');
      console.log('Email: Culturaviva1143@gmail.com');
      console.log('Senha: Museu1143');
    } else {
      console.error('❌ Erro:', error.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

createMasterUser();
