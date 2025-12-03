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
      where: { tenantId: tenantId as string }
    });

    const systemPrompt =
      persona?.systemPrompt ||
      "Você é um guia virtual de um museu, respondendo de forma acolhedora, inclusiva e acessível.";

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
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

export default router;
