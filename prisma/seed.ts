import { PrismaClient, Role, CategoryType } from "@prisma/client";
import bcrypt from "bcrypt";

const getOptimizedUrl = () => {
    let url = process.env.DATABASE_URL || "";
    if (url.includes("supabase.com") || url.includes("supabase.co") || url.includes("pooler.supabase.com")) {
        if (url.includes("@")) {
            const parts = url.split("@");
            const hostPart = parts[1];
            if (hostPart.includes(":")) {
                parts[1] = hostPart.replace(/:(\d+)/, ":6543");
            } else {
                const hostEnd = hostPart.indexOf("/") !== -1 ? hostPart.indexOf("/") : (hostPart.indexOf("?") !== -1 ? hostPart.indexOf("?") : hostPart.length);
                parts[1] = hostPart.slice(0, hostEnd) + ":6543" + hostPart.slice(hostEnd);
            }
            url = parts.join("@");
        }
        if (!url.includes("pgbouncer=true")) {
            const sep = url.includes("?") ? "&" : "?";
            url += `${sep}pgbouncer=true`;
        }
        if (!url.includes("connection_limit=")) {
            url += "&connection_limit=10";
        }
        if (!url.includes("sslmode=")) {
            url += "&sslmode=require";
        }
        if (!url.includes("pool_timeout=")) {
            url += "&pool_timeout=90";
        }
    }
    return url;
};

const prisma = new PrismaClient({
    datasources: { db: { url: getOptimizedUrl() } }
});

async function main() {
    console.log("🌱 Iniciando seed...");

    // 1. Criar Tenant Padrão (Museu Demo) se não existir
    let tenant = await prisma.tenant.findFirst({
        where: { slug: "museu-demo" }
    });

    if (!tenant) {
        console.log("🏛️ Criando Tenant: Museu de Demonstração...");
        tenant = await prisma.tenant.create({
            data: {
                name: "Museu de Demonstração",
                slug: "museu-demo",
                primaryColor: "#d4af37",
                secondaryColor: "#cd7f32",
                mission: "Demonstrar as funcionalidades do sistema Museus Enterprise."
            }
        });
    } else {
        console.log("✓ Tenant já existe.");
    }

    // 1.1 Criar EquipamentoCultural para o Museu Demo
    let defaultEquipamento = await prisma.equipamentoCultural.findFirst({
        where: { tenantId: tenant.id }
    });

    if (!defaultEquipamento) {
        console.log("🏛️ Criando Equipamento Cultural: Galeria Principal...");
        defaultEquipamento = await prisma.equipamentoCultural.create({
            data: {
                tenantId: tenant.id,
                nome: "Galeria Principal",
                slug: "galeria-principal",
                tipo: "museu",
                endereco: "Rua do Museu, 123",
                cidade: "Cidade das Artes",
                estado: "MG",
                ativo: true
            }
        });
    }

    // 2. Criar Usuário Master se não existir
    const email = "admin@museu.com";
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (!existingUser) {
        console.log("👤 Criando Usuário Master (admin@museu.com)...");
        const hashedPassword = await bcrypt.hash("123456", 10);

        await prisma.user.create({
            data: {
                email,
                name: "Admin Master",
                password: hashedPassword,
                role: Role.MASTER,
                tenantId: tenant.id
            }
        });
        console.log("🔑 Usuário Master criado! Email: admin@museu.com / Senha: 123456");
    } else {
        console.log("✓ Usuário Master já existe.");
    }

    // 2.1 Criar Usuário Admin para Museu Demo
    const adminEmail = "demo@museu.com";
    const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

    if (!existingAdmin) {
        console.log("👤 Criando Usuário Admin Demo (demo@museu.com)...");
        const hashedAdminPassword = await bcrypt.hash("123456", 10);

        await prisma.user.create({
            data: {
                email: adminEmail,
                name: "Admin Demo",
                password: hashedAdminPassword,
                role: Role.ADMIN,
                tenantId: tenant.id
            }
        });
        console.log("🔑 Usuário Admin Demo criado! Email: demo@museu.com / Senha: 123456");
    } else {
        console.log("✓ Usuário Admin Demo já existe.");
    }

    // 3. Criar Categorias se não existirem
    const categoriesData = [
        { name: "Pintura", description: "Obras de pintura em diversos estilos e épocas" },
        { name: "Escultura", description: "Esculturas em mármore, bronze e outros materiais" },
        { name: "Arte Moderna", description: "Obras do século XX e movimentos modernistas" },
        { name: "Renascimento", description: "Obras do período renascentista italiano" },
        { name: "Impressionismo", description: "Movimento artístico francês do século XIX" },
        { name: "Arte Brasileira", description: "Obras de artistas brasileiros" }
    ];

    console.log("📂 Criando categorias...");
    const categories: Record<string, string> = {};

    for (const cat of categoriesData) {
        let category = await prisma.category.findFirst({
            where: { name: cat.name, tenantId: tenant.id }
        });

        if (!category) {
            category = await prisma.category.create({
                data: {
                    name: cat.name,
                    description: cat.description,
                    type: CategoryType.WORK,
                    tenantId: tenant.id
                }
            });
        }
        categories[cat.name] = category.id;
    }
    console.log("✓ Categorias criadas!");

    // 4. Criar Obras de Arte Famosas
    const worksData = [
        // Renascimento
        {
            title: "Mona Lisa",
            artist: "Leonardo da Vinci",
            year: "1503-1517",
            categoryId: categories["Renascimento"],
            room: "Sala 1 - Renascimento Italiano",
            floor: "1º Andar",
            description: "A Mona Lisa, também conhecida como La Gioconda, é uma das pinturas mais famosas do mundo. O sorriso enigmático de Lisa Gherardini fascina visitantes há mais de 500 anos. A técnica do sfumato de Da Vinci cria uma atmosfera misteriosa única.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/e/ec/Mona_Lisa%2C_by_Leonardo_da_Vinci%2C_from_C2RMF_retouched.jpg"
        },
        {
            title: "A Última Ceia",
            artist: "Leonardo da Vinci",
            year: "1495-1498",
            categoryId: categories["Renascimento"],
            room: "Sala 1 - Renascimento Italiano",
            floor: "1º Andar",
            description: "Obra-prima que retrata o momento em que Jesus anuncia que um de seus discípulos irá traí-lo. A composição dramática e as expressões faciais dos apóstolos são estudadas até hoje.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/4/4b/%C3%9Altima_Cena_-_Da_Vinci_5.jpg"
        },
        {
            title: "O Nascimento de Vênus",
            artist: "Sandro Botticelli",
            year: "1485",
            categoryId: categories["Renascimento"],
            room: "Sala 1 - Renascimento Italiano",
            floor: "1º Andar",
            description: "Uma das obras mais icônicas do Renascimento, representa a deusa Vênus emergindo do mar como uma mulher adulta. A pintura simboliza o nascimento do amor e da beleza espiritual.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/0/0b/Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg"
        },
        {
            title: "A Criação de Adão",
            artist: "Michelangelo",
            year: "1508-1512",
            categoryId: categories["Renascimento"],
            room: "Sala 1 - Renascimento Italiano",
            floor: "1º Andar",
            description: "Parte do teto da Capela Sistina, esta pintura retrata o momento bíblico em que Deus dá vida a Adão. O quase toque entre os dedos tornou-se um dos símbolos mais reconhecidos da arte ocidental.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/5/5b/Michelangelo_-_Creation_of_Adam_%28cropped%29.jpg"
        },

        // Impressionismo
        {
            title: "Noite Estrelada",
            artist: "Vincent van Gogh",
            year: "1889",
            categoryId: categories["Impressionismo"],
            room: "Sala 2 - Impressionismo",
            floor: "1º Andar",
            description: "Pintada durante sua estadia no asilo de Saint-Rémy-de-Provence, esta obra representa a vista da janela de Van Gogh à noite. Os redemoinhos no céu e as estrelas brilhantes refletem seu estado emocional intenso.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg"
        },
        {
            title: "Os Girassóis",
            artist: "Vincent van Gogh",
            year: "1888",
            categoryId: categories["Impressionismo"],
            room: "Sala 2 - Impressionismo",
            floor: "1º Andar",
            description: "Série de pinturas que Van Gogh criou para decorar o quarto de seu amigo Gauguin. Os tons vibrantes de amarelo representam felicidade e gratidão, técnica característica do pós-impressionismo.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/4/46/Vincent_Willem_van_Gogh_127.jpg"
        },
        {
            title: "Impressão, Nascer do Sol",
            artist: "Claude Monet",
            year: "1872",
            categoryId: categories["Impressionismo"],
            room: "Sala 2 - Impressionismo",
            floor: "1º Andar",
            description: "A pintura que deu nome ao movimento Impressionista. Monet captura a atmosfera do porto de Le Havre ao amanhecer, com pinceladas soltas que priorizam a luz sobre os detalhes.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/5/59/Monet_-_Impression%2C_Sunrise.jpg"
        },
        {
            title: "As Ninfeias",
            artist: "Claude Monet",
            year: "1906",
            categoryId: categories["Impressionismo"],
            room: "Sala 2 - Impressionismo",
            floor: "1º Andar",
            description: "Série de aproximadamente 250 pinturas a óleo retratando o jardim aquático de Monet em Giverny. As obras capturam a luz e as cores em diferentes momentos do dia.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/a/aa/Claude_Monet_-_Water_Lilies_-_1906%2C_Ryerson.jpg"
        },
        {
            title: "Baile no Moulin de la Galette",
            artist: "Pierre-Auguste Renoir",
            year: "1876",
            categoryId: categories["Impressionismo"],
            room: "Sala 2 - Impressionismo",
            floor: "1º Andar",
            description: "Retrata um típico domingo à tarde no Moulin de la Galette, em Montmartre. A luz filtrada pelas árvores e a alegria dos dançarinos fazem desta uma das obras mais alegres do Impressionismo.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/2/21/Pierre-Auguste_Renoir%2C_Le_Moulin_de_la_Galette.jpg"
        },

        // Arte Moderna
        {
            title: "O Grito",
            artist: "Edvard Munch",
            year: "1893",
            categoryId: categories["Arte Moderna"],
            room: "Sala 3 - Arte Moderna",
            floor: "2º Andar",
            description: "Uma das imagens mais icônicas da arte moderna, expressando ansiedade universal. A figura distorcida e o céu vermelho-alaranjado transmitem uma sensação de desespero existencial.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/c/c5/Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73_cm%2C_National_Gallery_of_Norway.jpg"
        },
        {
            title: "Guernica",
            artist: "Pablo Picasso",
            year: "1937",
            categoryId: categories["Arte Moderna"],
            room: "Sala 3 - Arte Moderna",
            floor: "2º Andar",
            description: "Resposta de Picasso ao bombardeio da cidade basca de Guernica durante a Guerra Civil Espanhola. A obra em preto, branco e cinza é um poderoso símbolo anti-guerra.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/6/6f/Pablo_Picasso%27s_Guernica.jpg"
        },
        {
            title: "A Persistência da Memória",
            artist: "Salvador Dalí",
            year: "1931",
            categoryId: categories["Arte Moderna"],
            room: "Sala 3 - Arte Moderna",
            floor: "2º Andar",
            description: "Uma das obras surrealistas mais reconhecidas, apresenta relógios derretendo em uma paisagem onírica. Dalí explora a natureza subjetiva do tempo e a fragilidade da memória.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/en/d/dd/The_Persistence_of_Memory.jpg"
        },
        {
            title: "Les Demoiselles d'Avignon",
            artist: "Pablo Picasso",
            year: "1907",
            categoryId: categories["Arte Moderna"],
            room: "Sala 3 - Arte Moderna",
            floor: "2º Andar",
            description: "Considerada uma das obras mais influentes do século XX, marca a transição para o Cubismo. As cinco figuras femininas são representadas com formas angulares e fragmentadas.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/en/4/4c/Les_Demoiselles_d%27Avignon.jpg"
        },

        // Escultura
        {
            title: "Davi",
            artist: "Michelangelo",
            year: "1501-1504",
            categoryId: categories["Escultura"],
            room: "Sala 4 - Esculturas",
            floor: "Térreo",
            description: "Obra-prima da escultura renascentista, representa o herói bíblico Davi momentos antes de enfrentar Golias. Com 5,17 metros de altura, simboliza a força e a beleza da juventude.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/8/80/Michelangelo%27s_David_-_3.jpg"
        },
        {
            title: "O Pensador",
            artist: "Auguste Rodin",
            year: "1880-1904",
            categoryId: categories["Escultura"],
            room: "Sala 4 - Esculturas",
            floor: "Térreo",
            description: "Originalmente concebida como parte de 'As Portas do Inferno', esta escultura em bronze representa um homem em profunda meditação. Tornou-se símbolo universal da filosofia e do pensamento.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/The_Thinker_in_the_Garden_of_the_Mus%C3%A9e_Rodin_in_Paris%2C_France.jpg/800px-The_Thinker_in_the_Garden_of_the_Mus%C3%A9e_Rodin_in_Paris%2C_France.jpg"
        },
        {
            title: "Vênus de Milo",
            artist: "Alexandros de Antioquia",
            year: "130-100 a.C.",
            categoryId: categories["Escultura"],
            room: "Sala 4 - Esculturas",
            floor: "Térreo",
            description: "Antiga escultura grega representando a deusa Afrodite (Vênus para os romanos). Descoberta em 1820 na ilha de Milos, é uma das mais famosas esculturas gregas antigas.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/c/c2/Venus_de_Milo_Louvre_Ma399.jpg"
        },

        // Arte Brasileira
        {
            title: "Abaporu",
            artist: "Tarsila do Amaral",
            year: "1928",
            categoryId: categories["Arte Brasileira"],
            room: "Sala 5 - Arte Brasileira",
            floor: "2º Andar",
            description: "Ícone do Movimento Antropofágico brasileiro. A figura de pés e mãos grandes representa a ligação com a terra. O título vem do tupi e significa 'homem que come gente'.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/e/e0/Abaporu.jpg"
        },
        {
            title: "Operários",
            artist: "Tarsila do Amaral",
            year: "1933",
            categoryId: categories["Arte Brasileira"],
            room: "Sala 5 - Arte Brasileira",
            floor: "2º Andar",
            description: "Retrata a diversidade dos trabalhadores industriais brasileiros. Os rostos sem expressão representam a alienação e as condições de trabalho na era industrial.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/e/ea/Oper%C3%A1rios%2C_Trasila_do_Amaral_-_1933.jpg"
        },
        {
            title: "Independência ou Morte",
            artist: "Pedro Américo",
            year: "1888",
            categoryId: categories["Arte Brasileira"],
            room: "Sala 5 - Arte Brasileira",
            floor: "2º Andar",
            description: "Também conhecido como 'O Grito do Ipiranga', retrata o momento da declaração da independência do Brasil por Dom Pedro I. Uma das pinturas históricas mais importantes do país.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/commons/4/40/Independence_of_Brazil_1888.jpg"
        },
        {
            title: "A Negra",
            artist: "Tarsila do Amaral",
            year: "1923",
            categoryId: categories["Arte Brasileira"],
            room: "Sala 5 - Arte Brasileira",
            floor: "2º Andar",
            description: "Considerada precursora do Movimento Antropofágico, a obra representa a herança africana na formação da identidade brasileira. A figura monumental e as formas simplificadas são características marcantes.",
            imageUrl: "https://upload.wikimedia.org/wikipedia/en/8/8a/A_Negra.jpg"
        }
    ];

    console.log("🎨 Criando/Atualizando obras de arte...");

    for (const work of worksData) {
        const existingWork = await prisma.work.findFirst({
            where: {
                title: work.title,
                artist: work.artist,
                tenantId: tenant.id
            }
        });

        if (!existingWork) {
            await prisma.work.create({
                data: {
                    ...work,
                    tenantId: tenant.id,
                    equipamentoId: defaultEquipamento.id,
                    published: true
                }
            });
            console.log(`   ✓ [CRIADO] ${work.title} - ${work.artist}`);
        } else {
            // UPDATE IMAGE URL even if exists
            await prisma.work.update({
                where: { id: existingWork.id },
                data: { 
                    imageUrl: work.imageUrl,
                    equipamentoId: defaultEquipamento.id 
                }
            });
            console.log(`   ↻ [ATUALIZADO] ${work.title}`);
        }
    }

    console.log("✅ Seed finalizado!");
    console.log(`\n📊 Resumo:`);
    console.log(`   - Tenant: ${tenant.name}`);
    console.log(`   - Categorias: ${categoriesData.length}`);
    console.log(`   - Obras de arte: ${worksData.length}`);

    // ============================================================
    // SEED MUNICIPAL: Cidade de Betim com equipamentos culturais
    // ============================================================
    console.log("\n🏙️ Criando estrutura municipal de teste...");

    // Criar Tenant Cidade
    let cityTenant = await prisma.tenant.findFirst({
        where: { slug: "betim-cultura" }
    });

    if (!cityTenant) {
        cityTenant = await prisma.tenant.create({
            data: {
                name: "Secretaria de Cultura de Betim",
                slug: "betim-cultura",
                type: "CITY",
                primaryColor: "#1e40af",
                secondaryColor: "#3b82f6",
                mission: "Promover a cultura e as artes em Betim",
                isCityMode: true,
                // Habilitar features municipais
                featureEditais: true,
                featureProjects: true,
                featureAccessibilityMgmt: true,
                featureProviders: true,
                featureInstitutionalReports: true,
                // Features padrão
                featureEvents: true,
                featureGamification: true
            }
        });
        console.log("   ✓ Criado: Secretaria de Cultura de Betim (CITY)");
    } else {
        console.log("   ✓ Já existe: Secretaria de Cultura de Betim");
    }

    // Criar Museu filho
    let childMuseum = await prisma.tenant.findFirst({
        where: { slug: "museu-betim" }
    });

    if (!childMuseum) {
        childMuseum = await prisma.tenant.create({
            data: {
                name: "Museu Municipal de Betim",
                slug: "museu-betim",
                type: "MUSEUM",
                parentId: cityTenant.id,
                primaryColor: "#059669",
                secondaryColor: "#10b981",
                mission: "Preservar a história e memória de Betim",
                featureWorks: true,
                featureTrails: true,
                featureQRCodes: true,
                featureGamification: true
            }
        });
        console.log("   ✓ Criado: Museu Municipal de Betim (filho da cidade)");

        // Criar equipamento para o museu
        await prisma.equipamentoCultural.create({
            data: {
                tenantId: childMuseum.id,
                nome: "Sede Museu Betim",
                slug: "sede-museu-betim",
                tipo: "museu",
                endereco: "Centro, Betim",
                cidade: "Betim",
                estado: "MG"
            }
        });
    }

    // Criar Centro Cultural filho
    let childCultural = await prisma.tenant.findFirst({
        where: { slug: "centro-cultural-betim" }
    });

    if (!childCultural) {
        childCultural = await prisma.tenant.create({
            data: {
                name: "Centro Cultural de Betim",
                slug: "centro-cultural-betim",
                type: "CULTURAL_SPACE",
                parentId: cityTenant.id,
                primaryColor: "#7c3aed",
                secondaryColor: "#8b5cf6",
                mission: "Espaço de eventos e atividades culturais",
                featureEvents: true,
                featureGamification: true,
                featureCertificates: true
            }
        });
        console.log("   ✓ Criado: Centro Cultural de Betim (filho da cidade)");

        // Criar equipamento para o centro cultural
        await prisma.equipamentoCultural.create({
            data: {
                tenantId: childCultural.id,
                nome: "Teatro Municipal",
                slug: "teatro-municipal-betim",
                tipo: "teatro",
                endereco: "Praça Central, Betim",
                cidade: "Betim",
                estado: "MG"
            }
        });
    }

    // Criar admin para a cidade
    const cityAdminEmail = "admin@betim-cultura.gov.br";
    const existingCityAdmin = await prisma.user.findUnique({
        where: { email: cityAdminEmail }
    });

    if (!existingCityAdmin) {
        const hashedPassword = await bcrypt.hash("betim123", 10);
        await prisma.user.create({
            data: {
                email: cityAdminEmail,
                name: "Gestor Cultural Betim",
                password: hashedPassword,
                role: Role.ADMIN,
                tenantId: cityTenant.id
            }
        });
        console.log("   ✓ Criado: admin@betim-cultura.gov.br / Senha: betim123");
    }

    console.log("\n🏙️ Estrutura municipal criada!");
    console.log(`   - Cidade: ${cityTenant.name} (parentId: null)`);
    console.log(`   - Museu filho: ${childMuseum?.name || "existente"} (parentId: ${cityTenant.id})`);
    console.log(`   - Centro Cultural filho: ${childCultural?.name || "existente"} (parentId: ${cityTenant.id})`);

    // ============================================================
    // SEED: New Phase Features — Heritage, Check-ins, Cards, RPG
    // ============================================================
    console.log("\n✨ Populando novas tabelas...");

    // --- Intangible Heritage ---
    const heritageData = [
        { title: "Congada de Betim", description: "Manifestação cultural afro-brasileira com dança, canto e cortejo. Celebra reis e rainhas negros em festejo de sincretismo religioso.", category: "FESTEJO", status: "REGISTRADO", holders: "Comunidade do bairro São João", region: "Betim - MG" },
        { title: "Saber do Queijo Minas", description: "Técnica artesanal de fabricação do queijo Minas, transmitida entre gerações de produtores rurais da Serra da Mantiqueira.", category: "SABER", status: "REGISTRADO", holders: "Produtores da Serra da Mantiqueira", region: "Minas Gerais" },
        { title: "Festa do Divino Espírito Santo", description: "Celebração religiosa com procissões, novenas, danças e fartas distribuições de alimentos à comunidade.", category: "CELEBRACAO", status: "ATIVO", holders: "Paróquia São José", region: "Betim - MG" },
        { title: "Capoeira Regional", description: "Arte marcial brasileira que combina luta, dança, música e acrobacia. Patrimônio Cultural Imaterial da Humanidade.", category: "EXPRESSAO", status: "REGISTRADO", holders: "Mestres de capoeira locais", region: "Todo o município" },
        { title: "Praça da Matriz", description: "Lugar de memória e convivência comunitária, palco de feiras, encontros e manifestações culturais há mais de 100 anos.", category: "LUGAR", status: "ATIVO", holders: "Comunidade local", region: "Centro de Betim" }
    ];

    for (const h of heritageData) {
        const exists = await prisma.intangibleHeritage.findFirst({ where: { title: h.title, tenantId: tenant.id } });
        if (!exists) {
            await prisma.intangibleHeritage.create({ data: { ...h, tenantId: tenant.id } });
            console.log(`   ✓ Patrimônio: ${h.title}`);
        }
    }

    // --- Collectible Cards ---
    const cardsData = [
        { title: "Mona Lisa Dourada", description: "Card raro da obra mais famosa do mundo", rarity: "LEGENDARY", xpReward: 500, totalMinted: 10 },
        { title: "Explorador do Renascimento", description: "Visitou todas as obras da Sala do Renascimento", rarity: "EPIC", xpReward: 200, totalMinted: 50 },
        { title: "Primeira Visita", description: "Card comemorativo da sua primeira viagem ao museu", rarity: "COMMON", xpReward: 50, totalMinted: 1000 },
        { title: "Caçador de QR Codes", description: "Escaneou 10 QR Codes em uma única visita", rarity: "RARE", xpReward: 150, totalMinted: 100 },
        { title: "Madrugador Cultural", description: "Visitou o museu nos primeiros 30 minutos de abertura", rarity: "UNCOMMON", xpReward: 75, totalMinted: 200 },
        { title: "Mestre da Arte Moderna", description: "Completou todos os desafios da sala de Arte Moderna", rarity: "EPIC", xpReward: 250, totalMinted: 30 },
        { title: "Colecionador Supremo", description: "Coletou todos os cards disponíveis!", rarity: "LEGENDARY", xpReward: 1000, totalMinted: 5 }
    ];

    for (const card of cardsData) {
        const exists = await prisma.collectibleCard.findFirst({ where: { title: card.title, tenantId: tenant.id } });
        if (!exists) {
            await prisma.collectibleCard.create({ data: { ...card, tenantId: tenant.id } });
            console.log(`   ✓ Card: ${card.title} (${card.rarity})`);
        }
    }

    // --- Group Tickets ---
    const groupData = [
        { groupName: "Escola Municipal São Paulo", totalTickets: 35, contactName: "Maria Silva", contactEmail: "maria@escola-sp.edu.br", contactPhone: "(31) 99999-1111", status: "CONFIRMED" },
        { groupName: "Turma de Artes Visuais - UFMG", totalTickets: 22, contactName: "Prof. Carlos Souza", contactEmail: "carlos@ufmg.br", status: "PENDING" },
        { groupName: "Associação de Idosos Betim", totalTickets: 15, contactName: "Dona Aparecida", contactEmail: "assoc.idosos@betim.mg", contactPhone: "(31) 3333-4444", status: "CONFIRMED" }
    ];

    for (const g of groupData) {
        const exists = await prisma.groupTicket.findFirst({ where: { groupName: g.groupName, tenantId: tenant.id } });
        if (!exists) {
            await prisma.groupTicket.create({ data: { ...g, tenantId: tenant.id } });
            console.log(`   ✓ Grupo: ${g.groupName} (${g.totalTickets} ingressos)`);
        }
    }

    // --- Social Check-ins ---
    // Get some visitors to create check-ins
    const visitors = await prisma.visitor.findMany({ where: { tenantId: tenant.id }, take: 5 });
    const checkinMessages = [
        { message: "Incrível a exposição de Arte Moderna! 🎨", emoji: "🎨" },
        { message: "Primeira vez aqui e já amei!", emoji: "❤️" },
        { message: "Trouxe a família toda pra conhecer", emoji: "👀" },
        { message: "O Mona Lisa é ainda mais impressionante pessoalmente", emoji: "✨" },
        { message: "", emoji: "🏛️" }
    ];

    for (let i = 0; i < Math.min(visitors.length, checkinMessages.length); i++) {
        const existingCheckin = await prisma.socialCheckin.findFirst({ where: { visitorId: visitors[i].id, tenantId: tenant.id } });
        if (!existingCheckin) {
            await prisma.socialCheckin.create({
                data: { visitorId: visitors[i].id, tenantId: tenant.id, ...checkinMessages[i] }
            });
        }
    }
    if (visitors.length > 0) console.log(`   ✓ Check-ins: ${Math.min(visitors.length, checkinMessages.length)} criados`);

    // --- Visitor RPG profiles ---
    for (const v of visitors.slice(0, 3)) {
        const existingRPG = await prisma.visitorRPG.findUnique({ where: { visitorId: v.id } });
        if (!existingRPG) {
            const levels = [
                { characterName: "Explorador Destemido", characterClass: "APRENDIZ", level: 5, currentXp: 200, nextLevelXp: 250 },
                { characterName: "Mestre da Cultura", characterClass: "MESTRE", level: 12, currentXp: 800, nextLevelXp: 1500 },
                { characterName: "Novato Curioso", characterClass: "NOVATO", level: 2, currentXp: 50, nextLevelXp: 130 }
            ];
            const idx = visitors.indexOf(v);
            const lvl = levels[idx] || levels[0];
            await prisma.visitorRPG.create({ data: { visitorId: v.id, ...lvl, totalVisits: idx * 3 + 1, totalWorks: idx * 5 + 2 } });
        }
    }
    if (visitors.length > 0) console.log(`   ✓ RPG: ${Math.min(3, visitors.length)} perfis criados`);

    // --- Work Translations ---
    const works = await prisma.work.findMany({ where: { tenantId: tenant.id }, take: 3 });
    for (const w of works) {
        const exists = await prisma.workTranslation.findFirst({ where: { workId: w.id, language: "en" } });
        if (!exists) {
            await prisma.workTranslation.create({
                data: {
                    workId: w.id,
                    language: "en",
                    title: `${w.title} (EN)`,
                    description: `English translation of ${w.title}. This artwork is a masterpiece of ${w.artist || "an unknown artist"}.`,
                    tenantId: tenant.id
                }
            });
        }
    }
    if (works.length > 0) console.log(`   ✓ Traduções EN: ${works.length} obras traduzidas`);

    console.log("\n🎉 Seed completo com todas as novas tabelas!");
    console.log("   - Patrimônio Imaterial: 5 registros");
    console.log("   - Cards Colecionáveis: 7 cards");
    console.log("   - Ingressos de Grupo: 3 solicitações");
    console.log("   - Check-ins Sociais: até 5");
    console.log("   - Perfis RPG: até 3");
    console.log("   - Traduções EN: até 3 obras");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
