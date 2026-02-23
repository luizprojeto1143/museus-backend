import { Router } from "express";
import { prisma } from "../prisma.js";
import OpenAI from "openai";
import { authMiddleware } from "../middleware/auth.js";
import { aiLimiter } from "../middleware/rateLimiter.js";

const router = Router();

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

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
router.post("/chat/stream", authMiddleware, async (req, res) => {
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
    res.setHeader('Access-Control-Allow-Origin', '*');

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
router.post("/test", authMiddleware, async (req, res) => {
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
router.post("/souvenir", async (req, res) => {
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
      include: { stamps: { include: { work: true } } }
    });

    if (!visitor) {
      return res.status(404).json({ message: "Visitante não encontrado" });
    }

    const obras = visitor.stamps
      .map((s) => `- ${s.work?.title || "Obra sem título"} (visitada em ${s.stampedAt.toISOString().substring(0, 10)})`)
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
router.post("/itinerary", authMiddleware, async (req, res) => {
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
router.post("/tts", authMiddleware, async (req, res) => {
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

export default router;
