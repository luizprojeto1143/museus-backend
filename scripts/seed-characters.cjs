const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seedando Personagens Base...');

  const characters = [
    {
      name: 'Explorador das Sombras',
      description: 'Especialista em encontrar segredos escondidos nos cantos mais escuros do museu.',
      imageUrl: 'https://images.unsplash.com/photo-1519074063912-ad2a602159d7?q=80&w=200&h=200&auto=format&fit=crop',
      active: true,
      tenantId: null
    },
    {
      name: 'Guardião do Tempo',
      description: 'Protege a cronologia das obras e entende cada detalhe histórico.',
      imageUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=200&h=200&auto=format&fit=crop',
      active: true,
      tenantId: null
    },
    {
      name: 'Mestre das Cores',
      description: 'Sente a vibração de cada pincelada e entende a alma do artista.',
      imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=200&h=200&auto=format&fit=crop',
      active: true,
      tenantId: null
    },
    {
      name: 'Arqueólogo Digital',
      description: 'Mestre em decifrar códigos e encontrar conexões tecnológicas entre as obras.',
      imageUrl: 'https://images.unsplash.com/photo-1531427186611-ecfd6d936c79?q=80&w=200&h=200&auto=format&fit=crop',
      active: true,
      tenantId: null
    }
  ];

  for (const char of characters) {
    const exists = await prisma.characterBase.findFirst({
      where: { name: char.name }
    });

    if (!exists) {
      await prisma.characterBase.create({ data: char });
      console.log(`✅ Personagem criado: ${char.name}`);
    } else {
      console.log(`🟡 Personagem já existe: ${char.name}`);
    }
  }

  console.log('✨ Seed de personagens concluído!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
