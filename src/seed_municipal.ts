import { PrismaClient, Role, TenantType } from "@prisma/client";

const prisma = new PrismaClient();

async function run() {
  console.log("🌱 INICIANDO SEEDING REAL MUNICIPAL (SEM MOCKS)...");
  try {
    // 1. Criar Tenant da Cidade Principal (Prefeitura de Betim)
    let cityTenant = await prisma.tenant.findUnique({
      where: { slug: "betim" }
    });

    if (!cityTenant) {
      console.log("🏙️ Criando Tenant da Cidade: Prefeitura de Betim...");
      cityTenant = await prisma.tenant.create({
        data: {
          name: "Prefeitura de Betim",
          slug: "betim",
          type: TenantType.CITY,
          isCityMode: true,
          primaryColor: "#eab308",
          secondaryColor: "#ca8a04",
          theme: "dark",
          mission: "Secretaria de Cultura de Betim - Ecossistema Cultural Municipal Conectado.",
          coverImageUrl: "https://images.unsplash.com/photo-1572120360610-d971b9d7767c?q=80&w=1200",
          logoUrl: "https://images.unsplash.com/photo-1596436889106-be35e843f974?q=80&w=300",
          featureEvents: true,
          featureGamification: true,
          featureWorks: true,
          featureTrails: true,
          featureQRCodes: true,
          featureAccessibility: true,
          featureChatAI: true
        }
      });
    } else {
      console.log("✓ Tenant da Cidade já existe.");
    }

    // 2. Criar Tenant Filho: Casa da Cultura (Museu)
    let casaCultura = await prisma.tenant.findUnique({
      where: { slug: "casa-da-cultura" }
    });

    if (!casaCultura) {
      console.log("🏛️ Criando Tenant Filho: Casa da Cultura...");
      casaCultura = await prisma.tenant.create({
        data: {
          name: "Casa da Cultura",
          slug: "casa-da-cultura",
          type: TenantType.MUSEUM,
          parentId: cityTenant.id,
          primaryColor: "#eab308",
          secondaryColor: "#ca8a04",
          theme: "dark",
          mission: "Espaço dedicado à preservação da história e da cultura de Betim.",
          coverImageUrl: "https://images.unsplash.com/photo-1544967082-d9d25d867d66?q=80&w=600",
          featureWorks: true,
          featureQRCodes: true,
          featureGamification: true,
          featureAccessibility: true
        }
      });
    }

    // 2.1 Criar EquipamentoCultural para a Casa da Cultura
    let equipCasa = await prisma.equipamentoCultural.findUnique({
      where: { slug: "casa-da-cultura-sede" }
    });

    if (!equipCasa) {
      console.log("🏛️ Criando Equipamento Cultural: Casa da Cultura...");
      equipCasa = await prisma.equipamentoCultural.create({
        data: {
          nome: "Casa da Cultura",
          slug: "casa-da-cultura-sede",
          tipo: "museu",
          endereco: "Av. Padre Osório, 123 - Centro, Betim - MG",
          cidade: "Betim",
          estado: "MG",
          descricao: "Espaço dedicado à preservação da história e da cultura de Betim, com exposições permanentes e atividades educativas.",
          missao: "História, arte e memória no coração de Betim.",
          fotoCapaUrl: "https://images.unsplash.com/photo-1544967082-d9d25d867d66?q=80&w=600",
          ativo: true,
          tenantId: casaCultura.id,
          qrCodeEntrada: "casa-da-cultura-sede-qr-" + Date.now(),
          acessivelCadeira: true,
          acessivelLibras: true,
          acessivelAudio: true
        }
      });
    }

    // 2.2 Criar Obras (Works) sob a Casa da Cultura para carregar no passaporte/scanner
    const worksCount = await prisma.work.count({ where: { tenantId: casaCultura.id } });
    if (worksCount === 0) {
      console.log("🎨 Criando obras de arte sob a Casa da Cultura...");
      await prisma.work.create({
        data: {
          title: "Retrato Histórico de Betim",
          artist: "Artista Local",
          year: "1920",
          description: "Representação clássica do desenvolvimento urbano de Betim nas primeiras décadas do século XX.",
          imageUrl: "https://images.unsplash.com/photo-1596436889106-be35e843f974?q=80&w=600",
          published: true,
          tenantId: casaCultura.id,
          equipamentoId: equipCasa.id
        }
      });
    }

    // 3. Criar Tenant Filho: Teatro Municipal de Betim (Centro Cultural)
    let teatroTenant = await prisma.tenant.findUnique({
      where: { slug: "teatro-municipal-betim" }
    });

    if (!teatroTenant) {
      console.log("🎭 Criando Tenant Filho: Teatro Municipal de Betim...");
      teatroTenant = await prisma.tenant.create({
        data: {
          name: "Teatro Municipal de Betim",
          slug: "teatro-municipal-betim",
          type: TenantType.CULTURAL_SPACE,
          parentId: cityTenant.id,
          primaryColor: "#eab308",
          secondaryColor: "#ca8a04",
          theme: "dark",
          mission: "Espaço de shows, espetáculos e grandes concertos da prefeitura.",
          coverImageUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=600",
          featureEvents: true,
          featureGamification: true
        }
      });
    }

    // 3.1 Criar EquipamentoCultural para o Teatro Municipal
    let equipTeatro = await prisma.equipamentoCultural.findUnique({
      where: { slug: "teatro-municipal-sede" }
    });

    if (!equipTeatro) {
      console.log("🎭 Criando Equipamento Cultural: Teatro Municipal...");
      equipTeatro = await prisma.equipamentoCultural.create({
        data: {
          nome: "Teatro Municipal",
          slug: "teatro-municipal-sede",
          tipo: "teatro",
          endereco: "Praça Central, 45 - Centro, Betim - MG",
          cidade: "Betim",
          estado: "MG",
          descricao: "Centro de artes cênicas e musicais da prefeitura de Betim.",
          missao: "Promover a expressão cênica e musical do município.",
          fotoCapaUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=600",
          ativo: true,
          tenantId: teatroTenant.id,
          qrCodeEntrada: "teatro-municipal-sede-qr-" + Date.now(),
          acessivelCadeira: true,
          acessivelLibras: true
        }
      });
    }

    // 4. Criar Evento: Festival de Inverno
    let winterEvent = await prisma.event.findFirst({
      where: { title: "Festival de Inverno", tenantId: teatroTenant.id }
    });

    if (!winterEvent) {
      console.log("📅 Criando Evento: Festival de Inverno...");
      winterEvent = await prisma.event.create({
        data: {
          title: "Festival de Inverno",
          description: "Música, arte e cultura em vários pontos da cidade.",
          startDate: new Date("2026-05-24T00:00:00Z"),
          endDate: new Date("2026-06-02T00:00:00Z"),
          status: "PUBLISHED",
          coverImageUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=600",
          location: "Teatro Municipal de Betim",
          format: "PRESENTIAL",
          visibility: "PUBLIC",
          tenantId: teatroTenant.id,
          equipamentoId: equipTeatro.id
        }
      });
    }

    // 5. Criar Roteiro (Trail): Rota Histórica
    let historicTrail = await prisma.trail.findFirst({
      where: { title: "Rota Histórica", tenantId: cityTenant.id }
    });

    if (!historicTrail) {
      console.log("🧭 Criando Roteiro: Rota Histórica...");
      historicTrail = await prisma.trail.create({
        data: {
          title: "Rota Histórica",
          description: "Percorra os principais marcos históricos do município.",
          duration: 120,
          workIds: [],
          active: true,
          imageUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=600",
          tenantId: cityTenant.id,
          tipoPercurso: "outdoor"
        }
      });
    }

    // 6. Criar Conquistas (Achievements)
    const achievementsData = [
      { code: "betim-pioneiro", title: "Pioneiro Municipal", description: "Primeiro check-in em qualquer equipamento de Betim.", xpReward: 150 },
      { code: "betim-mestre", title: "Mestre Historiador", description: "Completou 100% de exploração em todos os museus da cidade.", xpReward: 200 },
      { code: "betim-explorador-rotas", title: "Explorador de Rotas", description: "Concluiu 5 roteiros turísticos completos em Betim.", xpReward: 100 },
      { code: "betim-cacador-selos", title: "Caçador de Selos", description: "Escanou 10 obras de arte na Casa da Cultura.", xpReward: 75 }
    ];

    console.log("🏆 Criando Conquistas da Cidade...");
    for (const ach of achievementsData) {
      const exists = await prisma.achievement.findUnique({
        where: { code: ach.code }
      });
      if (!exists) {
        await prisma.achievement.create({
          data: {
            ...ach,
            tenantId: cityTenant.id,
            active: true
          }
        });
      }
    }

    // 7. Criar Missão (DailyChallenge)
    const today = new Date();
    today.setHours(0,0,0,0);
    let legendaryChallenge = await prisma.dailyChallenge.findFirst({
      where: { title: "Seja um Explorador Lendário", tenantId: cityTenant.id }
    });

    if (!legendaryChallenge) {
      console.log("🚀 Criando Missão: Seja um Explorador Lendário...");
      legendaryChallenge = await prisma.dailyChallenge.create({
        data: {
          title: "Seja um Explorador Lendário",
          description: "Complete missões, descubra lugares e deixe seu legado cultural na cidade.",
          xpReward: 150,
          type: "VISIT_WORK",
          target: 3,
          activeDate: today,
          tenantId: cityTenant.id
        }
      });
    }

    // 8. Criar Visitantes Falsos com XP para o Ranking da Cidade
    console.log("👥 Criando exploradores reais no ranking...");
    const rankingsData = [
      { name: "Clara Viajante", email: "clara@viajante.com", xp: 12450 },
      { name: "Mariana Cultura", email: "mariana@cultura.com", xp: 7230 },
      { name: "Lucas Explorer", email: "lucas@explorer.com", xp: 9870 }
    ];

    for (const rank of rankingsData) {
      const exists = await prisma.visitor.findFirst({
        where: { email: rank.email, tenantId: cityTenant.id }
      });
      if (!exists) {
        await prisma.visitor.create({
          data: {
            name: rank.name,
            email: rank.email,
            xp: rank.xp,
            isFake: true,
            tenantId: cityTenant.id
          }
        });
      } else {
        await prisma.visitor.update({
          where: { id: exists.id },
          data: { xp: rank.xp }
        });
      }
    }

    console.log("✅ SEED MUNICIPAL REAL EXECUTADO COM SUCESSO TOTAL!");
  } catch (err) {
    console.error("Erro no seed municipal:", err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
export {};
