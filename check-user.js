import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkUser() {
  try {
    const user = await prisma.user.findUnique({
      where: { email: 'Culturaviva1143@gmail.com' }
    });
    
    if (user) {
      console.log('✅ Usuário encontrado:');
      console.log('Email:', user.email);
      console.log('Nome:', user.name);
      console.log('Role:', user.role);
      console.log('TenantId:', user.tenantId);
    } else {
      console.log('❌ Usuário não encontrado');
    }
  } catch (error) {
    console.error('Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUser();
