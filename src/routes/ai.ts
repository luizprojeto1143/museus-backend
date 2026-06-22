import { Router } from "express";
import { prisma } from "../prisma.js";
import OpenAI from "openai";
import { authMiddleware } from "../middleware/auth.js";
import { aiLimiter } from "../middleware/rateLimiter.js";
import multer from "multer";
import pdf from "pdf-parse";
import fs from "fs";

const router = Router();

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Configuração do multer para extração de PDF (temporário)
const upload = multer({ 
  dest: "uploads/temp/",
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Apenas arquivos PDF são permitidos") as any);
    }
    cb(null, true);
  }
});
if (!fs.existsSync("uploads/temp/")) {
  fs.mkdirSync("uploads/temp/", { recursive: true });
}

// Chat simples usando persona do tenant
// SECURITY: Rate Limiting applied (CRIT-008)
router.post("/chat", authMiddleware, aiLimiter, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ message: "OPENAI_API_KEY não configurada" });
    }
    const { tenantId, message } = req.body as { tenantId?: string; message?: string };
    if (!tenantId || !message) {
      return res.status(400).json({ message: "tenantId e message são obrigatórios" });
    }

    const persona = await prisma.chatPersona.findUnique({
      where: { tenantId: tenantId as string },
      include: { tenant: true }
    });

    // 1. Contexto do Museu
    const museumName = persona?.tenant?.name || "Museu";
    const museumAddress = persona?.tenant?.address || "Localização não informada";
    const museumMission = persona?.tenant?.mission || "";

    // 2. Obras (Catálogo)
    const works = await prisma.work.findMany({
      where: { tenantId: tenantId as string, published: true },
      select: { title: true, artist: true, room: true, description: true },
      take: 100 // Increased from 20 to 100 (FUNC-007)
    });
    const worksText = works.map(w =>
      `- Obra: "${w.title}" (${w.artist || "?"}, Sala ${w.room || "?"}). Detalhes: ${w.description ? w.description.substring(0, 150) + "..." : "N/A"}`
    ).join("\n");

    // 3. Eventos (Agenda - Próximos)
    const events = await prisma.event.findMany({
      where: { tenantId: tenantId as string, startDate: { gte: new Date() } },
      select: { title: true, startDate: true, location: true, description: true },
      take: 5,
      orderBy: { startDate: 'asc' }
    });
    const eventsText = events.map(e =>
      `- Evento: "${e.title}" em ${e.startDate.toLocaleDateString()} (${e.location || "Local não def."}). Detalhes: ${e.description || ""}`
    ).join("\n");

    // 4. Trilhas/Roteiros
    const trails = await prisma.trail.findMany({
      where: { tenantId: tenantId as string },
      select: { title: true, description: true, duration: true },
      take: 5
    });
    const trailsText = trails.map(t =>
      `- Roteiro: "${t.title}" (${t.duration || "?"} min). Sobre: ${t.description || ""}`
    ).join("\n");

    // 5. Arquivos de Contexto (Uploads marcados para IA)
    const contextFiles = await prisma.file.findMany({
      where: { tenantId: tenantId as string, useInAi: true },
      select: { filename: true, type: true, url: true }
    });

    const filesText = contextFiles.map(f =>
      `- Arquivo de Referência: "${f.filename}" (${f.type}). Link: ${f.url}`
    ).join("\n");

    const contextPrompt = `
    IDENTIDADE:
    Você é o guia oficial do ${museumName}, localizado em ${museumAddress}.
    ${museumMission ? `Missão: ${museumMission}` : ""}

    CONHECIMENTO DO ACERVO E AGENDA:
    Aqui está o que o museu oferece hoje. Use isso para responder aos visitantes:
    
    [OBRAS EM DESTAQUE]
    ${worksText || "Nenhuma obra listada no momento."}

    [PRÓXIMOS EVENTOS]
    ${eventsText || "Nenhum evento próximo agendado."}

    [ROTEIROS SUGERIDOS]
    ${trailsText || "Nenhum roteiro específico criado."}

    [ARQUIVOS DE REFERÊNCIA (DOCS/IMAGENS)]
    ${filesText || "Nenhum arquivo adicional disponível."}

    DIRETRIZES:
    - Responda como se conhecesse profundamente cada item acima.
    - Se perguntarem sobre algo que não está nesta lista, diga gentilmente que não tem essa informação no momento.
    - Seja breve e prestativo.
    - IMPORTANTE: Se perguntarem quem você é ou ao se apresentar, diga: "Sou a inteligência artificial do ${museumName}, localizado em ${museumAddress}."
    `;

    const baseSystemPrompt =
      persona?.systemPrompt ||
      "Você é um guia virtual acolhedor, inclusivo e acessível.";

    const finalSystemPrompt = `${contextPrompt}\n\n${baseSystemPrompt}`;

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: finalSystemPrompt },
        { role: "user", content: message }
      ]
    });

    const text = completion.choices[0]?.message?.content || "";

    return res.json({ text });
  } catch (err) {
    console.error("Erro IA chat", err);
    return res.status(500).json({ message: "Erro ao processar chat de IA" });
  }
});

// Streaming Chat using Server-Sent Events (SSE)
router.post("/chat/stream", authMiddleware, aiLimiter, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ message: "OPENAI_API_KEY não configurada" });
    }

    const { tenantId, message, conversationHistory = [] } = req.body as {
      tenantId?: string;
      message?: string;
      conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    if (!tenantId || !message) {
      return res.status(400).json({ message: "tenantId e message são obrigatórios" });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Secure CORS on SSE
    const origin = req.headers.origin;
    const allowedOrigin = process.env.NODE_ENV === "production" ? (process.env.FRONTEND_URL || "") : "*";
    if (allowedOrigin === "*") {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && allowedOrigin.split(",").map(o => o.trim()).includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      const firstAllowed = allowedOrigin.split(",")[0]?.trim();
      if (firstAllowed) {
        res.setHeader('Access-Control-Allow-Origin', firstAllowed);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    }

    // Build context (same as regular chat)
    const persona = await prisma.chatPersona.findUnique({
      where: { tenantId },
      include: { tenant: true }
    });

    const museumName = persona?.tenant?.name || "Museu";
    const museumAddress = persona?.tenant?.address || "Localização não informada";
    const museumMission = persona?.tenant?.mission || "";

    const works = await prisma.work.findMany({
      where: { tenantId, published: true },
      select: { title: true, artist: true, room: true, description: true },
      take: 15
    });

    const worksText = works.map(w =>
      `- "${w.title}" (${w.artist || "?"}, Sala ${w.room || "?"})`
    ).join("\\n");

    const events = await prisma.event.findMany({
      where: { tenantId, startDate: { gte: new Date() } },
      select: { title: true, startDate: true, location: true },
      take: 3,
      orderBy: { startDate: 'asc' }
    });

    const eventsText = events.map(e =>
      `- "${e.title}" em ${e.startDate.toLocaleDateString()} (${e.location || "Local TBD"})`
    ).join("\\n");

    const systemPrompt = `
    Você é o guia virtual do ${museumName}, localizado em ${museumAddress}.
    ${museumMission ? `Missão: ${museumMission}` : ""}
    
    ACERVO (obras disponíveis):
    ${worksText || "Nenhuma obra cadastrada."}
    
    EVENTOS PRÓXIMOS:
    ${eventsText || "Nenhum evento agendado."}
    
    INSTRUÇÕES:
    - Seja acolhedor, breve e informativo
    - Use emojis moderadamente para tornar a conversa amigável
    - Se não souber algo, diga gentilmente
    - Responda no idioma do usuário
    ${persona?.systemPrompt || ""}
    `;

    // Build messages array with history
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation history (last 10 messages max)
    const recentHistory = conversationHistory.slice(-10);
    for (const msg of recentHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // Add current message
    messages.push({ role: 'user', content: message });

    // Stream the response
    const stream = await openai.chat.completions.create({
      model: MODEL,
      messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\\n\\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\\n\\n`);
    res.end();

  } catch (err) {
    console.error("Erro IA stream", err);
    res.write(`data: ${JSON.stringify({ error: "Erro ao processar" })}\\n\\n`);
    res.end();
  }
});

// Rota de teste para o Admin (sem salvar persona)
router.post("/test", authMiddleware, aiLimiter, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ message: "OPENAI_API_KEY não configurada" });
    }
    const { message, persona } = req.body;

    if (!message || !persona) {
      return res.status(400).json({ message: "Dados incompletos" });
    }

    const systemPrompt = persona.systemPrompt || "Você é um guia virtual.";

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: persona.temperature || 0.7,
      max_tokens: persona.maxTokens || 500
    });

    const response = completion.choices[0]?.message?.content || "";
    return res.json({ response });
  } catch (err) {
    console.error("Erro IA test", err);
    return res.status(500).json({ message: "Erro ao testar IA" });
  }
});

// Souvenir simples
router.post("/souvenir", authMiddleware, aiLimiter, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ message: "OPENAI_API_KEY não configurada" });
    }
    const { tenantId, email } = req.body as { tenantId?: string; email?: string };
    if (!tenantId || !email) {
      return res.status(400).json({ message: "tenantId e email são obrigatórios" });
    }

    const persona = await prisma.chatPersona.findUnique({ where: { tenantId } });
    const systemPrompt =
      persona?.systemPrompt ||
      "Você é um guia de museu que cria textos de lembrança amigáveis, curtos e emocionantes sobre a visita.";

    const visitor = await prisma.visitor.findFirst({
      where: {
        email,
        tenantId
      },
      include: { passportStamps: { include: { work: true } } }
    });

    if (!visitor) {
      return res.status(404).json({ message: "Visitante não encontrado" });
    }

    const obras = visitor.passportStamps
      .map((s: any) => `- ${s.work?.title || "Obra sem título"} (visitada em ${s.stampedAt.toISOString().substring(0, 10)})`)
      .join("\n");

    const userPrompt = `Crie um texto de souvenir para o visitante com base nas obras que ele viu:\n${obras}`;

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const text = completion.choices[0]?.message?.content || "";

    return res.json({ text });
  } catch (err) {
    console.error("Erro IA souvenir", err);
    return res.status(500).json({ message: "Erro ao gerar souvenir" });
  }
});

// Roteiro Inteligente
router.post("/itinerary", authMiddleware, aiLimiter, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ message: "OPENAI_API_KEY não configurada" });
    }
    const { tenantId, preferences } = req.body;
    if (!tenantId || !preferences) {
      return res.status(400).json({ message: "tenantId e preferences são obrigatórios" });
    }

    // Buscar todas as obras do museu para a IA escolher
    const works = await prisma.work.findMany({
      where: { tenantId },
      select: { id: true, title: true, artist: true, category: { select: { name: true } }, room: true, description: true }
    });

    if (works.length === 0) {
      return res.json([]);
    }

    const systemPrompt = `Você é um curador especialista de museu. Crie um roteiro de visita personalizado.
    Retorne APENAS um JSON válido (sem markdown, sem explicações extras) contendo uma lista de IDs das obras recomendadas, na ordem de visitação.
    Formato esperado: ["id1", "id2", "id3"]
    
    Considere:
    - Tempo disponível: ${preferences.timeAvailable} minutos (aprox 10-15 min por obra)
    - Interesses: ${preferences.interests.join(", ")}
    - Acessibilidade: ${preferences.accessibility.join(", ")}
    
    Obras disponíveis:
    ${JSON.stringify(works.map(w => ({ id: w.id, title: w.title, category: w.category?.name, description: w.description })))}
    `;

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Gere o roteiro ideal para mim." }
      ],
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0]?.message?.content || "{}";
    let recommendedIds: string[] = [];

    try {
      const parsed = JSON.parse(content);
      // Tenta extrair a lista de várias formas possíveis que a IA pode retornar
      if (Array.isArray(parsed)) recommendedIds = parsed;
      else if (parsed.ids && Array.isArray(parsed.ids)) recommendedIds = parsed.ids;
      else if (parsed.works && Array.isArray(parsed.works)) recommendedIds = parsed.works;
      else if (parsed.itinerary && Array.isArray(parsed.itinerary)) recommendedIds = parsed.itinerary;
    } catch (e) {
      console.error("Erro ao parsear JSON da IA", e);
    }

    // Filtra as obras reais baseadas nos IDs retornados
    const itinerary = recommendedIds
      .map(id => works.find(w => w.id === id))
      .filter(w => w !== undefined);

    // Se a IA falhar ou retornar vazio, faz um fallback simples
    if (itinerary.length === 0) {
      const fallback = works.slice(0, Math.floor(preferences.timeAvailable / 15));
      return res.json(fallback);
    }

    return res.json(itinerary);

  } catch (err) {
    console.error("Erro IA itinerary", err);
    return res.status(500).json({ message: "Erro ao gerar roteiro" });
  }
});

// TTS Endpoint (requires auth to prevent abuse)
router.post("/tts", authMiddleware, aiLimiter, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ message: "OPENAI_API_KEY não configurada" });
    }
    const { text, voice } = req.body;

    if (!text) {
      return res.status(400).json({ message: "Texto é obrigatório" });
    }

    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice: voice || "onyx",
      input: text,
    });

    const buffer = Buffer.from(await response.arrayBuffer());

    // Return audio directly
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": buffer.length,
    });

    return res.send(buffer);

  } catch (err: any) {
    console.error("Erro IA TTS", err?.message || err);
    const errorMessage = err?.message || "Erro desconhecido ao gerar áudio";
    return res.status(500).json({ message: errorMessage });
  }
});

// Auto-Translation Endpoint
router.post("/translate", authMiddleware, aiLimiter, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ message: "OPENAI_API_KEY não configurada" });
    }
    const { title, description } = req.body;

    if (!title && !description) {
      return res.status(400).json({ message: "Título ou descrição são obrigatórios para tradução" });
    }

    const systemPrompt = `Você é um tradutor especializado em arte e cultura trabalhando para um museu.
Sua tarefa é traduzir o título e a descrição fornecidos para o Inglês e Espanhol.
Retorne APENAS um JSON válido contendo as traduções, com a seguinte estrutura exata:
{
  "en": {
    "title": "translated title",
    "description": "translated description"
  },
  "es": {
    "title": "título traducido",
    "description": "descripción traducida"
  }
}
Mantenha o tom cultural, profissional e adequado para um catálogo de museu. Se algum campo original estiver vazio, deixe-o vazio na tradução.`;

    const userPrompt = `Por favor, traduza os seguintes textos:
Título: ${title || ""}
Descrição: ${description || ""}`;

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3, // Mais precisão para tradução
    });

    const content = completion.choices[0]?.message?.content || "{}";

    try {
      const parsed = JSON.parse(content);
      return res.json(parsed);
    } catch (e) {
      console.error("Erro ao parsear JSON da tradução", e);
      return res.status(500).json({ message: "Erro ao formatar resposta da tradução" });
    }

  } catch (err) {
    console.error("Erro IA translate", err);
    return res.status(500).json({ message: "Erro ao gerar tradução" });
  }
});

// Rota para extração de dados de PDF
router.post("/extract-pdf", authMiddleware, upload.single("file"), aiLimiter, async (req, res) => {
  try {
    if (!openai) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(500).json({ message: "OPENAI_API_KEY não configurada" });
    }

    const { type } = req.body; // 'work' ou 'trail'
    if (!req.file) {
      return res.status(400).json({ message: "Arquivo PDF é obrigatório" });
    }

    let text = "";
    try {
      const dataBuffer = fs.readFileSync(req.file.path);
      // Validate magic bytes: %PDF-
      if (dataBuffer.length < 5 || dataBuffer.toString("utf8", 0, 5) !== "%PDF-") {
        return res.status(400).json({ message: "Arquivo inválido. Apenas arquivos PDF reais são permitidos." });
      }

      const data = await (pdf as any)(dataBuffer);
      text = data.text;
    } catch (e: any) {
      console.error("Erro ao ler/parsear PDF:", e);
      return res.status(400).json({ message: "Erro ao parsear arquivo PDF. Certifique-se de que é um PDF válido." });
    } finally {
      if (req.file && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.error("Erro deletando arquivo temporário:", e);
        }
      }
    }

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ message: "Não foi possível extrair texto do PDF. O arquivo pode estar vazio ou ser apenas imagem." });
    }

    const systemPromptFallback = type === 'work' 
      ? "Você é um assistente de museu especializado em catalogação de obras de arte."
      : "Você é um assistente de museu especializado em criação de roteiros e trilhas.";

    const schema = type === 'work' 
      ? `{
          "title": "título da obra",
          "artist": "nome do artista",
          "year": "ano de criação (apenas o ano)",
          "description": "uma descrição detalhada e atraente da obra",
          "technique": "técnica utilizada",
          "period": "período ou estilo artístico",
          "medium": "suporte ou material",
          "dimensions": "dimensões da obra",
          "room": "sala sugerida",
          "floor": "andar sugerido"
        }`
      : `{
          "title": "título da trilha",
          "description": "uma descrição atraente que convide o visitante a seguir este roteiro"
        }`;

    const userPrompt = `Abaixo está o texto extraído de um PDF:
    
    ---
    ${text.substring(0, 15000)}
    ---
    
    Por favor, extraia as informações relevantes para cadastrar uma ${type === 'work' ? 'obra' : 'trilha'} de museu.
    Retorne APENAS um JSON válido com a seguinte estrutura:
    ${schema}
    
    Se alguma informação não for encontrada, deixe o campo como uma string vazia.
    Responda em Português do Brasil.`;

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPromptFallback },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const content = completion.choices[0]?.message?.content || "{}";
    const extractedData = JSON.parse(content);

    return res.json(extractedData);

  } catch (err) {
    console.error("❌ Erro na extração de PDF:", err);
    return res.status(500).json({ 
      message: "Erro ao extrair informações do PDF", 
      error: err instanceof Error ? err.message : String(err) 
    });
  }
});

// Refinar Proposta Cultural (Ajudante do Agente Cultural)
router.post("/refine-proposal", authMiddleware, aiLimiter, async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ message: "OPENAI_API_KEY não configurada" });
    }

    const { field, projectTitle, projectCurrentText, noticeObjectives, noticeRequirements } = req.body;

    if (!field || !projectTitle) {
      return res.status(400).json({ message: "Campos obrigatórios ausentes (field, projectTitle)" });
    }

    const systemPrompt = `Você é um consultor especialista em projetos culturais e leis de incentivo (como Lei Rouanet, Paulo Gustavo, Aldir Blanc).
Sua tarefa é ajudar o Agente Cultural a escrever ou melhorar o campo "${field}" do seu projeto intitulado "${projectTitle}".

DIRETRIZES:
1. Use uma linguagem profissional, persuasiva e culturalmente rica.
2. ALINHAMENTO COM O EDITAL: Utilize os objetivos e requisitos fornecidos para garantir que o texto atenda às expectativas dos avaliadores.
3. Se o texto atual for fornecido, melhore-o mantendo a essência original. Se estiver vazio, gere um novo texto inspirador.
4. Mantenha o foco em impacto social, democratização do acesso e viabilidade cultural.
5. Retorne APENAS o texto refinado, sem introduções ou comentários extras.

CONTEXTO DO EDITAL:
- Objetivos: ${noticeObjectives || "Não informados"}
- Requisitos: ${noticeRequirements || "Não informados"}
`;

    const userPrompt = projectCurrentText 
      ? `Melhore o seguinte texto para o campo "${field}":\n\n${projectCurrentText}`
      : `Gere um texto inicial para o campo "${field}" do projeto "${projectTitle}".`;

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content || "";
    return res.json({ response });

  } catch (err) {
    console.error("Erro IA refine-proposal", err);
    return res.status(500).json({ message: "Erro ao refinar proposta" });
  }
});

export default router;
