import { PrismaClient, Role, CategoryType } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

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
                    published: true
                }
            });
            console.log(`   ✓ [CRIADO] ${work.title} - ${work.artist}`);
        } else {
            // UPDATE IMAGE URL even if exists
            await prisma.work.update({
                where: { id: existingWork.id },
                data: { imageUrl: work.imageUrl }
            });
            console.log(`   ↻ [ATUALIZADO] ${work.title}`);
        }
    }

    console.log("✅ Seed finalizado!");
    console.log(`\n📊 Resumo:`);
    console.log(`   - Tenant: ${tenant.name}`);
    console.log(`   - Categorias: ${categoriesData.length}`);
    console.log(`   - Obras de arte: ${worksData.length}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
