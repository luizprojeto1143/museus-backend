import OpenAI from "openai";
import { prisma } from "../prisma.js";
import { trackAIUsage } from "../middleware/aiUsage.js";

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * Analisa um projeto cultural usando IA
 */
export async function analyzeProjectWithAI(projectId: string, tenantId: string) {
    try {
        if (!openai) {
            console.error("OpenAI API Key não configurada");
            return null;
        }

        // 1. Buscar projeto com edital e tenant
        const project = await prisma.culturalProject.findUnique({
            where: { id: projectId },
            include: {
                Notice: true,
                tenant: true
            }
        });

        if (!project || !project.Notice) {
            console.error("Projeto ou edital não encontrado");
            return null;
        }

        // 2. Montar Prompt
        const prompt = `
        Você é um avaliador técnico de projetos culturais para uma Secretaria de Cultura.
        Sua tarefa é analisar a proposta abaixo comparando-a com os requisitos e objetivos do edital vinculado.

        DADOS DO EDITAL:
        Título: ${project.Notice?.title || ""}
        Descrição: ${project.Notice.description || "N/A"}
        Objetivos: ${project.Notice.objectives || "N/A"}
        Requisitos: ${project.Notice.requirements || "N/A"}
        Teto por projeto: R$ ${project.Notice.maxPerProject || "N/A"}
        Acessibilidade obrigatória: ${project.Notice.requiresAccessibilityPlan ? "Sim" : "Não"}

        DADOS DO PROJETO:
        Título: ${project.title}
        Resumo: ${project.summary || "N/A"}
        Descrição: ${project.description || "N/A"}
        Justificativa: ${project.justification || "N/A"}
        Orçamento solicitado: R$ ${project.requestedBudget || "N/A"}
        Público estimado: ${project.expectedAudience || "N/A"}
        Plano de Acessibilidade: ${JSON.stringify(project.accessibilityPlan || {})}

        INSTRUÇÕES DE ANÁLISE:
        1. Gere um resumo claro de 3-4 frases sobre a proposta.
        2. Identifique pontos fortes e pontos fracos/ausentes.
        3. Verifique cada requisito do edital.
        4. Atribua scores de 0 a 100 para: Relevância, Clareza, Viabilidade, Impacto, Acessibilidade e Adequação Orçamentária.
        5. Forneça uma recomendação final: APPROVE, REJECT ou REVIEW.

        RESPOSTA:
        Sua resposta deve ser EXCLUSIVAMENTE um JSON válido no seguinte formato:
        {
          "summary": "string",
          "strengths": ["string"],
          "weaknesses": ["string"],
          "requirementsCheck": [
            { "requirement": "string", "met": boolean, "justification": "string" }
          ],
          "scores": {
            "relevance": number,
            "clarity": number,
            "feasibility": number,
            "impact": number,
            "accessibility": number,
            "budget": number
          },
          "totalScore": number,
          "recommendation": "APPROVE" | "REJECT" | "REVIEW",
          "recommendationReason": "string",
          "flags": ["string"],
          "analyzedAt": "ISO Date"
        }
        `;

        // 3. Chamar OpenAI
        const completion = await openai.chat.completions.create({
            model: MODEL,
            messages: [
                { role: "system", content: "Você é um assistente de análise técnica de editais culturais. Responda apenas em JSON." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.3
        });

        const resultText = completion.choices[0]?.message?.content || "{}";
        const aiAnalysis = JSON.parse(resultText);
        aiAnalysis.analyzedAt = new Date().toISOString();

        // Calcular Score Final se houver nota humana anterior
        let finalScore = null;
        const scores = aiAnalysis.scores || {};
        const scoreValues = Object.values(scores) as number[];
        if (scoreValues.length > 0) {
            const aiAvg = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length;
            if (project.humanScore !== null && project.humanScore !== undefined) {
                finalScore = (aiAvg + project.humanScore) / 2;
            } else {
                finalScore = aiAvg;
            }
        }

        // 4. Salvar no banco
        await prisma.culturalProject.update({
            where: { id: projectId },
            data: {
                aiAnalysis,
                aiAnalyzedAt: new Date(),
                finalScore
            }
        });

        // 5. Contabilizar uso
        await trackAIUsage(tenantId, "PROJECT_ANALYSIS" as any, completion.usage?.total_tokens);

        return aiAnalysis;

    } catch (err) {
        console.error("Erro na análise IA do projeto:", err);
        return null;
    }
}
