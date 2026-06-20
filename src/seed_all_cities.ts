import { PrismaClient, Role, TenantType } from "@prisma/client";

const prisma = new PrismaClient();

async function run() {
  console.log("🌱 INICIANDO SEEDING REAL MULTI-CIDADES (SEM MOCKS)...");
  try {
    const citiesData = [
      {
        name: "Prefeitura de Betim",
        slug: "betim",
        primaryColor: "#eab308",
        secondaryColor: "#ca8a04",
        mission: "Secretaria de Cultura de Betim - Ecossistema Cultural Municipal Conectado.",
        coverImageUrl: "https://images.unsplash.com/photo-1572120360610-d971b9d7767c?q=80&w=1200",
        logoUrl: "https://images.unsplash.com/photo-1596436889106-be35e843f974?q=80&w=300",
        latitude: -19.9676,
        longitude: -44.2008,
        children: [
          {
            name: "Casa da Cultura de Betim",
            slug: "casa-da-cultura",
            type: TenantType.MUSEUM,
            mission: "Espaço dedicado à preservação da história e da cultura de Betim.",
            coverImageUrl: "https://images.unsplash.com/photo-1544967082-d9d25d867d66?q=80&w=600",
            equipamento: {
              nome: "Casa da Cultura",
              slug: "casa-da-cultura-sede",
              tipo: "museu",
              endereco: "Av. Padre Osório, 123 - Centro, Betim - MG",
              descricao: "Espaço dedicado à preservação da história e da cultura de Betim, com exposições permanentes.",
              fotoCapaUrl: "https://images.unsplash.com/photo-1544967082-d9d25d867d66?q=80&w=600",
              acessivelCadeira: true,
              acessivelLibras: true,
              acessivelAudio: true
            },
            works: [
              {
                title: "Retrato Histórico de Betim",
                artist: "Artista Local",
                year: "1920",
                description: "Representação clássica do desenvolvimento urbano de Betim nas primeiras décadas do século XX.",
                imageUrl: "https://images.unsplash.com/photo-1596436889106-be35e843f974?q=80&w=600"
              }
            ]
          },
          {
            name: "Teatro Municipal de Betim",
            slug: "teatro-municipal-betim",
            type: TenantType.CULTURAL_SPACE,
            mission: "Espaço de shows, espetáculos e grandes concertos da prefeitura.",
            coverImageUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=600",
            equipamento: {
              nome: "Teatro Municipal",
              slug: "teatro-municipal-sede",
              tipo: "teatro",
              endereco: "Praça Central, 45 - Centro, Betim - MG",
              descricao: "Centro de artes cênicas e musicais da prefeitura de Betim.",
              fotoCapaUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=600",
              acessivelCadeira: true,
              acessivelLibras: true,
              acessivelAudio: false
            },
            works: []
          }
        ],
        events: [
          {
            title: "Festival de Inverno de Betim",
            description: "Música, arte e cultura em vários pontos da cidade.",
            coverImageUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=600",
            location: "Teatro Municipal de Betim",
            startDate: new Date("2026-05-24T00:00:00Z"),
            endDate: new Date("2026-06-02T00:00:00Z")
          }
        ],
        trails: [
          {
            title: "Rota Histórica de Betim",
            description: "Percorra os principais marcos históricos do município.",
            imageUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=600",
            duration: 120
          }
        ],
        achievements: [
          { code: "betim-pioneiro", title: "Pioneiro Municipal", description: "Primeiro check-in em qualquer equipamento de Betim.", xpReward: 150 },
          { code: "betim-mestre", title: "Mestre Historiador", description: "Completou 100% de exploração em todos os museus da cidade.", xpReward: 200 },
          { code: "betim-explorador-rotas", title: "Explorador de Rotas", description: "Concluiu 5 roteiros turísticos completos em Betim.", xpReward: 100 },
          { code: "betim-cacador-selos", title: "Caçador de Selos", description: "Escanou 10 obras de arte na Casa da Cultura.", xpReward: 75 }
        ],
        challenge: {
          title: "Seja um Explorador Lendário",
          description: "Complete missões, descubra lugares e deixe seu legado cultural na cidade de Betim.",
          xpReward: 150
        }
      },
      {
        name: "Prefeitura de Ouro Preto",
        slug: "ouro-preto",
        primaryColor: "#d97706",
        secondaryColor: "#b45309",
        mission: "Secretaria de Turismo e Cultura de Ouro Preto - Patrimônio Mundial da Humanidade.",
        coverImageUrl: "https://images.unsplash.com/photo-1596436889106-be35e843f974?q=80&w=1200",
        logoUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=300",
        latitude: -20.3856,
        longitude: -43.5035,
        children: [
          {
            name: "Museu da Inconfidência",
            slug: "museu-da-inconfidencia",
            type: TenantType.MUSEUM,
            mission: "Espaço dedicado à memória da Inconfidência Mineira e história local.",
            coverImageUrl: "https://images.unsplash.com/photo-1596436889106-be35e843f974?q=80&w=600",
            equipamento: {
              nome: "Museu da Inconfidência",
              slug: "museu-inconfidencia-sede",
              tipo: "museu",
              endereco: "Praça Tiradentes, 139 - Centro, Ouro Preto - MG",
              descricao: "Memorial dedicado à Inconfidência Mineira e aos heróis da pátria.",
              fotoCapaUrl: "https://images.unsplash.com/photo-1596436889106-be35e843f974?q=80&w=600",
              acessivelCadeira: true,
              acessivelLibras: true,
              acessivelAudio: true
            },
            works: [
              {
                title: "Panteão dos Inconfidentes",
                artist: "Vários",
                year: "1942",
                description: "Local onde repousam os restos mortais dos heróis inconfidentes.",
                imageUrl: "https://images.unsplash.com/photo-1596436889106-be35e843f974?q=80&w=600"
              }
            ]
          },
          {
            name: "Igreja de São Francisco de Assis",
            slug: "igreja-sao-francisco",
            type: TenantType.MUSEUM,
            mission: "Obra-prima do barroco mineiro com relevos de Aleijadinho.",
            coverImageUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=600",
            equipamento: {
              nome: "Igreja de São Francisco",
              slug: "igreja-sao-francisco-sede",
              tipo: "museu",
              endereco: "Largo de Coimbra, s/n - Centro, Ouro Preto - MG",
              descricao: "Uma das igrejas barrocas mais famosas do Brasil, com teto pintado por Mestre Ataíde.",
              fotoCapaUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=600",
              acessivelCadeira: false,
              acessivelLibras: false,
              acessivelAudio: true
            },
            works: [
              {
                title: "Pintura da Assunção de Nossa Senhora",
                artist: "Mestre Ataíde",
                year: "1810",
                description: "Famosa pintura perspectiva no teto da nave central representando a assunção de Maria.",
                imageUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=600"
              }
            ]
          }
        ],
        events: [
          {
            title: "Festival de Inverno de Ouro Preto",
            description: "Uma celebração nacional de música, poesia e artes plásticas em Ouro Preto.",
            coverImageUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=600",
            location: "Largo de Coimbra e Teatros",
            startDate: new Date("2026-07-10T00:00:00Z"),
            endDate: new Date("2026-07-25T00:00:00Z")
          }
        ],
        trails: [
          {
            title: "Roteiro dos Inconfidentes",
            description: "Caminhe pelos mesmos caminhos percorridos por Tiradentes e seus companheiros.",
            imageUrl: "https://images.unsplash.com/photo-1596436889106-be35e843f974?q=80&w=600",
            duration: 180
          }
        ],
        achievements: [
          { code: "ouro-preto-pioneiro", title: "Pioneiro de Ouro Preto", description: "Fez check-in pela primeira vez na cidade imperial.", xpReward: 150 },
          { code: "ouro-preto-inconfidente", title: "Membro da Conjuração", description: "Visitou o Museu da Inconfidência e a Igreja São Francisco.", xpReward: 200 }
        ],
        challenge: {
          title: "Trilha da Liberdade",
          description: "Desbrave os caminhos históricos e complete check-ins em Ouro Preto.",
          xpReward: 150
        }
      },
      {
        name: "Prefeitura de Belo Horizonte",
        slug: "belo-horizonte",
        primaryColor: "#0284c7",
        secondaryColor: "#0369a1",
        mission: "Secretaria Municipal de Cultura de Belo Horizonte - Cidade Criativa da Gastronomia.",
        coverImageUrl: "https://images.unsplash.com/photo-1543857778-c4a1a3e0b2eb?q=80&w=1200",
        logoUrl: "https://images.unsplash.com/photo-1543857778-c4a1a3e0b2eb?q=80&w=300",
        latitude: -19.9191,
        longitude: -43.9386,
        children: [
          {
            name: "Museu de Arte da Pampulha",
            slug: "museu-pampulha",
            type: TenantType.MUSEUM,
            mission: "Museu dedicado à arte contemporânea no complexo moderno de Niemeyer.",
            coverImageUrl: "https://images.unsplash.com/photo-1543857778-c4a1a3e0b2eb?q=80&w=600",
            equipamento: {
              nome: "Museu de Arte da Pampulha",
              slug: "museu-pampulha-sede",
              tipo: "museu",
              endereco: "Av. Otacílio Negrão de Lima, 16585 - Pampulha, Belo Horizonte - MG",
              descricao: "Antigo Cassino da Pampulha, parte do Conjunto Moderno projetado por Oscar Niemeyer.",
              fotoCapaUrl: "https://images.unsplash.com/photo-1543857778-c4a1a3e0b2eb?q=80&w=600",
              acessivelCadeira: true,
              acessivelLibras: true,
              acessivelAudio: false
            },
            works: [
              {
                title: "Painel de Azulejos de Portinari",
                artist: "Cândido Portinari",
                year: "1943",
                description: "Famoso painel artístico de azulejos decorativos na área externa do museu.",
                imageUrl: "https://images.unsplash.com/photo-1543857778-c4a1a3e0b2eb?q=80&w=600"
              }
            ]
          }
        ],
        events: [
          {
            title: "Virada Cultural de BH",
            description: "24 horas ininterruptas de arte, teatro, cinema, circo, dança e gastronomia por toda a capital.",
            coverImageUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=600",
            location: "Centro de BH e Praça da Estação",
            startDate: new Date("2026-06-15T00:00:00Z"),
            endDate: new Date("2026-06-16T23:59:59Z")
          }
        ],
        trails: [
          {
            title: "Roteiro Arquitetônico da Pampulha",
            description: "Explore o Patrimônio Cultural da Humanidade da Pampulha, conhecendo as curvas de Niemeyer.",
            imageUrl: "https://images.unsplash.com/photo-1543857778-c4a1a3e0b2eb?q=80&w=600",
            duration: 150
          }
        ],
        achievements: [
          { code: "bh-pioneiro", title: "Pioneiro da Capital", description: "Seu primeiro registro de visita na capital mineira.", xpReward: 150 },
          { code: "bh-pampulha-lover", title: "Modernista Pampulha", description: "Visitou o Museu de Arte da Pampulha e completou o roteiro.", xpReward: 200 }
        ],
        challenge: {
          title: "Desafio da Pampulha",
          description: "Explore o complexo da Pampulha, escaneie os QRs e complete as missões diárias.",
          xpReward: 150
        }
      },
      {
        name: "Prefeitura de Sabará",
        slug: "sabara",
        primaryColor: "#059669",
        secondaryColor: "#047857",
        mission: "Secretaria de Cultura de Sabará - Joia do Ouro Colonial e da Jabuticaba.",
        coverImageUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=1200",
        logoUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=300",
        latitude: -19.8872,
        longitude: -43.8115,
        children: [
          {
            name: "Museu do Ouro de Sabará",
            slug: "museu-do-ouro",
            type: TenantType.MUSEUM,
            mission: "Antiga Casa de Fundição da coroa portuguesa que abriga arte e tecnologia colonial.",
            coverImageUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=600",
            equipamento: {
              nome: "Museu do Ouro",
              slug: "museu-do-ouro-sede",
              tipo: "museu",
              endereco: "Rua da Intendência, s/n - Centro, Sabará - MG",
              descricao: "Única Casa de Fundição do período colonial que resistiu até os dias de hoje no Brasil.",
              fotoCapaUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=600",
              acessivelCadeira: true,
              acessivelLibras: false,
              acessivelAudio: true
            },
            works: [
              {
                title: "Balança Colonial de Fundição",
                artist: "Desconhecido",
                year: "1730",
                description: "Balança monumental de ferro utilizada na pesagem e tributação do ouro da coroa.",
                imageUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=600"
              }
            ]
          }
        ],
        events: [
          {
            title: "Festival da Jabuticaba de Sabará",
            description: "O maior e mais tradicional festival de jabuticabas, licores e doces do Brasil.",
            coverImageUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=600",
            location: "Centro Histórico de Sabará",
            startDate: new Date("2026-11-12T00:00:00Z"),
            endDate: new Date("2026-11-15T23:59:59Z")
          }
        ],
        trails: [
          {
            title: "Caminho do Ouro de Sabará",
            description: "Trilha guiada pelas igrejas, ruínas de pedras e ruas coloniais da histórica cidade.",
            imageUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=600",
            duration: 100
          }
        ],
        achievements: [
          { code: "sabara-pioneiro", title: "Pioneiro de Sabará", description: "Sua primeira visita registrada em Sabará.", xpReward: 150 },
          { code: "sabara-mestre", title: "Mestre do Ouro", description: "Completou a visita ao Museu do Ouro e provou jabuticaba.", xpReward: 200 }
        ],
        challenge: {
          title: "Missão Sabarabuçu",
          description: "Desvende as histórias de Sabará respondendo a quizzes na Casa de Fundição.",
          xpReward: 150
        }
      },
      {
        name: "Prefeitura de Mariana",
        slug: "mariana",
        primaryColor: "#dc2626",
        secondaryColor: "#b91c1c",
        mission: "Secretaria de Cultura e Turismo de Mariana - A Primeira Capital de Minas Gerais.",
        coverImageUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=1200",
        logoUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=300",
        latitude: -20.3777,
        longitude: -43.4162,
        children: [
          {
            name: "Museu de Arte Sacra de Mariana",
            slug: "museu-arte-sacra-mariana",
            type: TenantType.MUSEUM,
            mission: "Preservação da memória religiosa barroca no palácio antigo de Mariana.",
            coverImageUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=600",
            equipamento: {
              nome: "Museu de Arte Sacra",
              slug: "museu-arte-sacra-sede",
              tipo: "museu",
              endereco: "Rua Direita, 22 - Centro, Mariana - MG",
              descricao: "Espaço contendo magníficas obras em talha, pratas e imagens de Aleijadinho e Mestre Ataíde.",
              fotoCapaUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=600",
              acessivelCadeira: false,
              acessivelLibras: true,
              acessivelAudio: true
            },
            works: [
              {
                title: "Órgão Arp Schnitger da Sé de Mariana",
                artist: "Arp Schnitger",
                year: "1701",
                description: "Instrumento histórico de tubos de fabricação alemã enviado pelo rei dom João V.",
                imageUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=600"
              }
            ]
          }
        ],
        events: [
          {
            title: "Encontro de Bandas de Mariana",
            description: "Encontro tradicional das antigas corporações musicais mineiras e bandas civis.",
            coverImageUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=600",
            location: "Praça da Sé e Palcos Municipais",
            startDate: new Date("2026-08-20T00:00:00Z"),
            endDate: new Date("2026-08-23T23:59:59Z")
          }
        ],
        trails: [
          {
            title: "Trilha das Minas de Ouro",
            description: "Roteiro turístico unindo as minas de ouro do período colonial com a bela natureza marianense.",
            imageUrl: "https://images.unsplash.com/photo-1568230315894-1edd16d248b7?q=80&w=600",
            duration: 140
          }
        ],
        achievements: [
          { code: "mariana-pioneiro", title: "Pioneiro da Primaz", description: "Sua primeira visita registrada em Mariana.", xpReward: 150 },
          { code: "mariana-sacra", title: "Mestre da Arte Sacra", description: "Visitou o Museu de Arte Sacra de Mariana.", xpReward: 200 }
        ],
        challenge: {
          title: "Explorador Sacro",
          description: "Decifre os enigmas barrocos e complete check-ins nas minas e capelas de Mariana.",
          xpReward: 150
        }
      }
    ];

    for (const city of citiesData) {
      console.log(`🏙️ Semeando cidade: ${city.name} (${city.slug})...`);
      
      // 1. Criar/Atualizar Tenant da Cidade
      let cityTenant = await prisma.tenant.findUnique({
        where: { slug: city.slug }
      });

      if (!cityTenant) {
        cityTenant = await prisma.tenant.create({
          data: {
            name: city.name,
            slug: city.slug,
            type: TenantType.CITY,
            isCityMode: true,
            primaryColor: city.primaryColor,
            secondaryColor: city.secondaryColor,
            theme: "dark",
            mission: city.mission,
            coverImageUrl: city.coverImageUrl,
            logoUrl: city.logoUrl,
            latitude: city.latitude,
            longitude: city.longitude,
            featureEvents: true,
            featureGamification: true,
            featureWorks: true,
            featureTrails: true,
            featureQRCodes: true,
            featureAccessibility: true,
            featureChatAI: true
          }
        });
        console.log(` - Tenant criado com sucesso.`);
      } else {
        cityTenant = await prisma.tenant.update({
          where: { id: cityTenant.id },
          data: {
            coverImageUrl: city.coverImageUrl,
            logoUrl: city.logoUrl,
            latitude: city.latitude,
            longitude: city.longitude
          }
        });
        console.log(` - Tenant já existia, atualizado.`);
      }

      // 2. Criar/Atualizar Tenants Filhos e seus Equipamentos
      for (const child of city.children) {
        let childTenant = await prisma.tenant.findUnique({
          where: { slug: child.slug }
        });

        if (!childTenant) {
          childTenant = await prisma.tenant.create({
            data: {
              name: child.name,
              slug: child.slug,
              type: child.type,
              parentId: cityTenant.id,
              primaryColor: city.primaryColor,
              secondaryColor: city.secondaryColor,
              theme: "dark",
              mission: child.mission,
              coverImageUrl: child.coverImageUrl,
              featureWorks: true,
              featureQRCodes: true,
              featureGamification: true,
              featureAccessibility: true
            }
          });
        }

        let equip = await prisma.equipamentoCultural.findUnique({
          where: { slug: child.equipamento.slug }
        });

        if (!equip) {
          equip = await prisma.equipamentoCultural.create({
            data: {
              nome: child.equipamento.nome,
              slug: child.equipamento.slug,
              tipo: child.equipamento.tipo,
              endereco: child.equipamento.endereco,
              cidade: city.name.replace("Prefeitura de ", ""),
              estado: "MG",
              descricao: child.equipamento.descricao,
              missao: child.mission,
              fotoCapaUrl: child.equipamento.fotoCapaUrl,
              ativo: true,
              tenantId: childTenant.id,
              qrCodeEntrada: child.equipamento.slug + "-qr-" + Date.now(),
              acessivelCadeira: child.equipamento.acessivelCadeira,
              acessivelLibras: child.equipamento.acessivelLibras,
              acessivelAudio: child.equipamento.acessivelAudio
            }
          });
        }

        // Criar Obras
        for (const w of child.works) {
          const workExists = await prisma.work.findFirst({
            where: { title: w.title, tenantId: childTenant.id }
          });
          if (!workExists) {
            await prisma.work.create({
              data: {
                title: w.title,
                artist: w.artist,
                year: w.year,
                description: w.description,
                imageUrl: w.imageUrl,
                published: true,
                tenantId: childTenant.id,
                equipamentoId: equip.id
              }
            });
          }
        }
      }

      // 3. Criar Eventos da Cidade
      for (const ev of city.events) {
        const evExists = await prisma.event.findFirst({
          where: { title: ev.title, tenantId: cityTenant.id }
        });
        if (!evExists) {
          await prisma.event.create({
            data: {
              title: ev.title,
              description: ev.description,
              coverImageUrl: ev.coverImageUrl,
              location: ev.location,
              startDate: ev.startDate,
              endDate: ev.endDate,
              status: "PUBLISHED",
              format: "PRESENTIAL",
              visibility: "PUBLIC",
              tenantId: cityTenant.id
            }
          });
        }
      }

      // 4. Criar Roteiros da Cidade
      for (const tr of city.trails) {
        const trExists = await prisma.trail.findFirst({
          where: { title: tr.title, tenantId: cityTenant.id }
        });
        if (!trExists) {
          await prisma.trail.create({
            data: {
              title: tr.title,
              description: tr.description,
              imageUrl: tr.imageUrl,
              duration: tr.duration,
              workIds: [],
              active: true,
              tenantId: cityTenant.id,
              tipoPercurso: "outdoor"
            }
          });
        }
      }

      // 5. Criar Conquistas da Cidade
      for (const ach of city.achievements) {
        const achExists = await prisma.achievement.findUnique({
          where: { code: ach.code }
        });
        if (!achExists) {
          await prisma.achievement.create({
            data: {
              code: ach.code,
              title: ach.title,
              description: ach.description,
              xpReward: ach.xpReward,
              tenantId: cityTenant.id,
              active: true
            }
          });
        }
      }

      // 6. Criar Missão Ativa da Cidade
      const today = new Date();
      today.setHours(0,0,0,0);
      const chExists = await prisma.dailyChallenge.findFirst({
        where: { title: city.challenge.title, tenantId: cityTenant.id }
      });
      if (!chExists) {
        await prisma.dailyChallenge.create({
          data: {
            title: city.challenge.title,
            description: city.challenge.description,
            xpReward: city.challenge.xpReward,
            type: "VISIT_WORK",
            target: 3,
            activeDate: today,
            tenantId: cityTenant.id
          }
        });
      }

      // 7. Semeando Exploradores Falsos no Ranking
      const rankingsData = [
        { name: "Clara Viajante", email: `clara@viajante-${city.slug}.com`, xp: 12450 },
        { name: "Mariana Cultura", email: `mariana@cultura-${city.slug}.com`, xp: 7230 },
        { name: "Lucas Explorer", email: `lucas@explorer-${city.slug}.com`, xp: 9870 }
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
    }

    console.log("✅ SEED MULTI-CIDADES REALIZADO COM SUCESSO TOTAL!");
  } catch (err) {
    console.error("Erro no seed municipal:", err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
