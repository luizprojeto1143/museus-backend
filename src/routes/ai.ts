import { Router } from "express";
import { prisma } from "../prisma.js";
import OpenAI from "openai";

const router = Router();

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Chat simples usando persona do tenant
router.post("/chat", async (req, res) => {
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
      take: 20
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

// Rota de teste para o Admin (sem salvar persona)
router.post("/test", async (req, res) => {
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
router.post("/itinerary", async (req, res) => {
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

// TTS Endpoint
router.post("/tts", async (req, res) => {
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

  } catch (err) {
    console.error("Erro IA TTS", err);
    return res.status(500).json({ message: "Erro ao gerar áudio" });
  }
});

export default router;
