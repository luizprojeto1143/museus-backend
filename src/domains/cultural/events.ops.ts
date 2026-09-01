import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../../prisma.js";
import { authMiddleware, requireRole, requirePermission } from "../../middleware/auth.js";
import { Role, PlatformFeeSource } from "@prisma/client";
import { getPlatformFee } from "../../services/fee.service.js";
import { sendCertificateEmail, generateCertificateBuffer } from "../../services/email.js";
import { z } from "zod";
import { createAuditLog } from "../governance/audit.js";
import { validate } from "../../middleware/validate.js";
import { createEventSchema, updateEventSchema } from "../../schemas/event.schema.js";
import { stripe, stripeService } from "../../services/stripeService.js";
import { dispatchEvent, backgroundQueue } from "../../infrastructure/queue/bullmq.setup.js";
import { assertTenantOwnership } from "../../utils/ownership.js";
import { deliverTenantWebhooks } from "../../services/outboundWebhook.service.js";

async function validateEventRelations(tenantId: string, relations: { categoryId?: string | null; equipamentoId?: string | null }) {
  if (relations.categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: relations.categoryId, tenantId }
    });
    if (!category) {
      throw Object.assign(new Error("Categoria nao encontrada neste tenant"), { status: 400 });
    }
  }
  if (relations.equipamentoId) {
    const equipamento = await prisma.equipamentoCultural.findFirst({
      where: { id: relations.equipamentoId, tenantId }
    });
    if (!equipamento) {
      throw Object.assign(new Error("Equipamento nao encontrado neste tenant"), { status: 400 });
    }
  }
}

export function registerEventOps(router: Router) {
router.get("/:id/report", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Get Event with related data
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        tenant: { select: { name: true, slug: true } },
        category: { select: { name: true } },
        tickets: true,
        registrations: {
          include: {
            ticket: { select: { name: true, price: true } },
            visitor: { select: { name: true, email: true, photoUrl: true } }
          },
          orderBy: { createdAt: "desc" }
        },
        surveyQuestions: {
          include: {
            surveyResponses: true
          },
          orderBy: { order: "asc" }
        }
      }
    });

    if (!event) {
      return res.status(404).json({ error: "Evento não encontrado" });
    }

    if (req.user!.role !== Role.MASTER && event.tenantId !== req.user!.tenantId) {
      return res.status(403).json({ message: "Sem permissao para acessar este relatorio" });
    }

    // 2. Calculate Stats
    const totalRegistrations = event.registrations.length;
    const totalCheckedIn = event.registrations.filter(r => r.status === "CHECKED_IN").length;
    const attendanceRate = totalRegistrations > 0
      ? Math.round((totalCheckedIn / totalRegistrations) * 100)
      : 0;

    // Revenue
    const totalRevenue = event.registrations.reduce(
      (sum, r) => sum + Number(r.pricePaid || 0),
      0
    );

    // Tickets breakdown
    const ticketsBreakdown = event.tickets.map(t => ({
      id: t.id,
      name: t.name,
      quantity: t.quantity,
      sold: t.sold,
      available: t.quantity - t.sold,
      price: Number(t.price),
      revenue: t.sold * Number(t.price)
    }));

    // 3. Survey Results
    const surveyResults = event.surveyQuestions.map(q => {
      const responses = q.surveyResponses;
      const totalResponses = responses.length;

      let aggregation: Record<string, unknown> = { count: totalResponses };

      if (q.type === "STARS" || q.type === "NPS") {
        const numericAnswers = responses
          .map(r => parseFloat(r.answer))
          .filter(n => !isNaN(n));

        const average = numericAnswers.length > 0
          ? numericAnswers.reduce((a, b) => a + b, 0) / numericAnswers.length
          : 0;

        const distribution: Record<string, number> = {};
        numericAnswers.forEach(n => {
          const key = String(Math.round(n));
          distribution[key] = (distribution[key] || 0) + 1;
        });

        aggregation = {
          average: Math.round(average * 10) / 10,
          distribution,
          count: numericAnswers.length
        };

        if (q.type === "NPS") {
          const promoters = numericAnswers.filter(n => n >= 9).length;
          const detractors = numericAnswers.filter(n => n <= 6).length;
          const npsScore = totalResponses > 0
            ? Math.round(((promoters - detractors) / totalResponses) * 100)
            : 0;
          (aggregation as any).npsScore = npsScore;
          (aggregation as any).promoters = promoters;
          (aggregation as any).detractors = detractors;
          (aggregation as any).passives = numericAnswers.length - promoters - detractors;
        }
      } else if (q.type === "CHOICE") {
        const distribution: Record<string, number> = {};
        responses.forEach(r => {
          distribution[r.answer] = (distribution[r.answer] || 0) + 1;
        });
        aggregation = { distribution, count: totalResponses };
      } else {
        aggregation = {
          recentAnswers: responses.slice(-5).map(r => r.answer),
          count: totalResponses
        };
      }

      return {
        id: q.id,
        question: q.question,
        type: q.type,
        options: q.options,
        totalResponses,
        aggregation
      };
    });

    // Survey overall satisfaction
    const starsQuestions = event.surveyQuestions.filter(q => q.type === "STARS");
    let overallSatisfaction = 0;
    if (starsQuestions.length > 0) {
      const allStarsResponses = starsQuestions.flatMap(q =>
        q.surveyResponses.map(r => parseFloat(r.answer)).filter(n => !isNaN(n))
      );
      if (allStarsResponses.length > 0) {
        overallSatisfaction = Math.round(
          (allStarsResponses.reduce((a, b) => a + b, 0) / allStarsResponses.length) * 10
        ) / 10;
      }
    }

    // 4. Participants list
    const participants = event.registrations.map(r => ({
      id: r.id,
      name: r.guestName || r.visitor?.name || "Anônimo",
      email: r.guestEmail || r.visitor?.email || "",
      photoUrl: r.visitor?.photoUrl || null,
      ticketName: r.ticket.name,
      status: r.status,
      checkInDate: r.checkInDate,
      registeredAt: r.createdAt
    }));

    // 5. Build Report
    const report = {
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        startDate: event.startDate,
        endDate: event.endDate,
        location: event.location,
        format: event.format,
        category: event.category?.name || null,
        tenant: event.tenant.name
      },
      stats: {
        totalRegistrations,
        totalCheckedIn,
        attendanceRate,
        totalRevenue,
        ticketsBreakdown
      },
      survey: {
        questionsCount: event.surveyQuestions.length,
        totalResponses: surveyResults.reduce((sum, q) => sum + q.totalResponses, 0),
        uniqueRespondents: new Set(
          event.surveyQuestions.flatMap(q =>
            q.surveyResponses.map(r => r.visitorId || r.guestEmail)
          )
        ).size,
        overallSatisfaction,
        questions: surveyResults
      },
      participants
    };

    res.json(report);
  } catch (error) {
    console.error("Error generating report:", error);
    res.status(500).json({ error: "Erro ao gerar relatório" });
  }
});

// ========== OMNICHANNEL BOX OFFICE (BILHETERIA GLOBAL) ==========

// 1. Fetch All Active Events (Theater + General) for POS
router.get("/pos/sessions", authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;

    if (!tenantId && user.role !== "MASTER") {
      return res.status(400).json({ message: "TenantId não identificado para PDV" });
    }

    const whereClause: any = { deletedAt: null, status: "PUBLISHED" };
    if (tenantId && user.role !== "MASTER") {
      whereClause.OR = [
        { tenantId: tenantId },
        { tenant: { parentId: tenantId } }
      ];
    }

    const events = await prisma.event.findMany({
      where: whereClause,
      include: {
        space: true,
        _count: {
          select: { registrations: true, theaterSeatReservations: true }
        }
      },
      orderBy: { startDate: "asc" }
    });

    return res.json(events);
  } catch (err) {
    console.error("Erro fetching POS sessions", err);
    return res.status(500).json({ message: "Erro ao buscar sessões do PDV" });
  }
});

// 2. Process POS Sale for Standard Events (No Seats, No Stripe)
router.post("/:id/pos-sell", authMiddleware, requireRole([Role.ADMIN, Role.PRODUCER, Role.COLLABORATOR, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const { ticketId, quantity, paymentMethod } = req.body;
    const user = req.user!;
    const requestedQuantity = Number(quantity);

    if (!ticketId || !quantity || !paymentMethod) {
      return res.status(400).json({ message: "Faltam parâmetros obrigatórios." });
    }

    if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 50) {
      return res.status(400).json({ message: "Quantidade de ingressos invalida" });
    }

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ message: "Evento não encontrado" });

    // Validate Authorization
    if (user.role !== "MASTER" && event.tenantId !== user.tenantId) {
      return res.status(403).json({ message: "Sem permissão para vender neste evento" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const tickets = await tx.$queryRaw<any[]>`SELECT * FROM "Ticket" WHERE id = ${ticketId} FOR UPDATE`;
      const ticket = tickets[0];
      if (!ticket) throw new Error("Ingresso não encontrado");
      if (ticket.eventId !== id) throw new Error("Ingresso inválido para este evento");
      
      if (ticket.sold + requestedQuantity > ticket.quantity) {
        throw new Error("Estoque de ingressos insuficiente.");
      }

      // Sprint 15: Calcular taxa via Central de Taxas (Bilheteria / TICKET)
      const amountCents = Math.round(Number(ticket.price) * requestedQuantity * 100);
      const feeResult = await getPlatformFee({
        tenantId: event.tenantId,
        sourceType: PlatformFeeSource.TICKET,
        amountCents
      });
      const totalAmount = Number(ticket.price) * requestedQuantity;
      const totalFee = feeResult.platformFeeCents / 100;

      // Create Financial Transaction
      const finTx = await tx.financialTransaction.create({
        data: {
          tenantId: event.tenantId,
          type: "PAYMENT",
          source: "REGISTRATION",
          amount: totalAmount,
          fee: totalFee,
          netAmount: totalAmount - totalFee,
          status: "COMPLETED",
          paymentMethod: paymentMethod || "CASH",
          // Sprint 15 fee snapshot
          feeConfigId: feeResult.configId,
          platformFeePercent: feeResult.percentage,
          platformFeeAmountCents: feeResult.platformFeeCents,
          feePaidBy: feeResult.feePaidBy
        }
      });

      // Generate tickets
      const registrations = [];
      for (let i = 0; i < requestedQuantity; i++) {
        const code = `PDV-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        
        const registration = await tx.registration.create({
          data: {
            eventId: id,
            ticketId,
            guestName: "Visitante PDV", // PDV tickets are anonymous initially
            guestEmail: "pdv@local",
            code,
            status: "CONFIRMED", // Confirmed automatically since payment is physically received
            pricePaid: Number(ticket.price),
            financialTransactionId: finTx.id
          }
        });
        registrations.push(registration);
      }

      // Update Stock
      await tx.ticket.update({
        where: { id: ticketId },
          data: { sold: { increment: requestedQuantity } }
      });

      return { registrations, total: totalAmount, transactionId: finTx.id };
    });

    return res.json({ success: true, ...result });

  } catch (err: any) {
    console.error("Erro no PDV Sell", err);
    return res.status(400).json({ message: err.message || "Erro na venda física." });
  }
});


}
