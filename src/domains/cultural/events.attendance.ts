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

export function registerEventAttendance(router: Router) {
router.get("/:id/my-attendance", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    // Find visitor associated with user and tenant of this event
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ message: "Evento não encontrado" });

    const visitor = await prisma.visitor.findFirst({
      where: { email: user.email, tenantId: event.tenantId }
    });

    if (!visitor) {
      return res.json({ attended: false });
    }

    const attendance = await prisma.eventAttendance.findFirst({
      where: { eventId: id, visitorId: visitor.id }
    });

    return res.json({ attended: !!attendance, attendance, visitorId: visitor.id });
  } catch (err) {
    console.error("Erro my-attendance", err);
    return res.status(500).json({ message: "Erro ao verificar presença" });
  }
});

// Check-in no evento (requires authentication)
router.post("/:id/checkin", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const isPrivileged = user.role === Role.ADMIN || user.role === Role.MASTER || user.role === Role.PRODUCER || (user.role === Role.COLLABORATOR && user.permissions?.manage_scanner);

    // Initialize variables
    let visitorId: string | undefined = req.body.visitorId;
    let email: string | undefined = req.body.email;

    const event = await prisma.event.findUnique({
      where: { id },
      include: { tenant: true }
    });

    if (!event) {
      return res.status(404).json({ message: "Evento não encontrado" });
    }

    if (!isPrivileged) {
      // SECURITY: Visitors can ONLY check-in themselves
      // We ignore the body 'visitorId'/'email' and force the current user
      const meVisitor = await prisma.visitor.findFirst({
        where: { email: user.email, tenantId: event.tenantId }
      });

      if (!meVisitor) {
        return res.status(403).json({ message: "Você não tem um perfil de visitante neste local." });
      }

      // Force ID from authenticated user
      visitorId = meVisitor.id;
      email = undefined; // clear email provided in body for safety
    }

    if (!visitorId && !email) {
      return res.status(400).json({ message: "É necessário informar visitorId ou email" });
    }

    let targetVisitorId = visitorId;

    // Se forneceu email (Privileged only effectively, or self)
    if (email) {
      const visitor = await prisma.visitor.findFirst({
        where: { email, tenantId: event.tenantId }
      });
      if (!visitor) {
        return res.status(404).json({ message: "Visitante não encontrado neste museu" });
      }
      targetVisitorId = visitor.id;
    } else if (visitorId) {
      // Verify existence if passed ID directly
      // (If unprivileged, we already fetched meVisitor, so we know it exists.
      // If privileged, we need to check if the ID passed is real)
      if (isPrivileged) {
        const visitor = await prisma.visitor.findUnique({ where: { id: visitorId } });
        if (!visitor) return res.status(404).json({ message: "Visitante não encontrado" });
        targetVisitorId = visitor.id;
      }
    }

    if (!targetVisitorId) {
      return res.status(400).json({ message: "Visitante não identificado." });
    }

    // Verificar se já fez check-in
    // Race-condition free check-in using try/catch create
    try {
      const attendance = await prisma.eventAttendance.create({
        data: {
          eventId: id,
          visitorId: targetVisitorId,
          status: "PRESENT",
          checkInTime: new Date()
        }
      });

      // Update Registration Status if exists (Sync with Producer Dashboard)
      const updatedRegistrations = await prisma.registration.findMany({
        where: { eventId: id, visitorId: targetVisitorId, status: "CONFIRMED" },
        select: { id: true, ticketId: true, code: true, guestName: true, guestEmail: true }
      });
      await prisma.registration.updateMany({
        where: { eventId: id, visitorId: targetVisitorId, status: "CONFIRMED" },
        data: { status: "CHECKED_IN", checkInDate: new Date() }
      });

      for (const registration of updatedRegistrations) {
        deliverTenantWebhooks(event.tenantId, "ticket.checked_in", {
          registrationId: registration.id,
          eventId: id,
          ticketId: registration.ticketId,
          code: registration.code,
          guestName: registration.guestName,
          guestEmail: registration.guestEmail,
          checkedInAt: new Date().toISOString(),
          source: "EVENT_CHECKIN"
        }).catch(err => console.error("Ticket checked-in webhook delivery failed:", err));
      }

      // Add XP logic if check-in successful (first time)
      await prisma.$transaction([
        prisma.visitorVisit.create({
          data: {
            visitorId: targetVisitorId,
            eventId: id,
            tenantId: event.tenantId,
            source: "CHECKIN",
            xpGained: 10
          }
        }),
        prisma.visitor.update({
          where: { id: targetVisitorId },
          data: { xp: { increment: 10 } }
        })
      ]);

      // Hook: Event Attended
      try {
        const { CertificateEngine } = await import('../../services/certificate-engine.js');
        await CertificateEngine.evaluate('EVENT_ATTENDED', {
          tenantId: event.tenantId,
          visitorId: targetVisitorId,
          eventId: id
        });
        // Also check XP threshold
        const updatedVisitor = await prisma.visitor.findUnique({ where: { id: targetVisitorId } });
        if (updatedVisitor) {
          await CertificateEngine.evaluate('XP_THRESHOLD', {
            tenantId: event.tenantId,
            visitorId: targetVisitorId,
            newXp: updatedVisitor.xp
          });
        }
      } catch (e) {
        console.error("Hook Error", e);
      }

      return res.json({ message: "Check-in realizado com sucesso", attendance });

    } catch (err: unknown) {
      // Prisma P2002: Unique constraint violation
      // @ts-expect-error - Prisma error types are tricky to import generically without dedicated helper
      if (err?.code === 'P2002') {
        const existing = await prisma.eventAttendance.findFirst({
          where: { eventId: id, visitorId: targetVisitorId }
        });
        return res.json({ message: "Check-in já realizado", attendance: existing });
      }
      throw err; // Rethrow to outer catch
    }
  } catch (err) {
    console.error("Erro check-in critical", err);
    return res.status(500).json({ message: "Erro interno no check-in" });
  }
});

// Enviar Certificado
// Baixar Certificado (Sympla style)
router.get("/:id/certificate/download", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const event = await prisma.event.findUnique({
      where: { id },
      include: { tenant: true }
    });

    if (!event) return res.status(404).json({ message: "Evento não encontrado" });

    // Find visitor
    const visitor = await prisma.visitor.findFirst({
      where: { email: user.email, tenantId: event.tenantId }
    });

    if (!visitor) return res.status(404).json({ message: "Visitante não identificado" });

    const attendance = await prisma.eventAttendance.findFirst({
      where: { eventId: id, visitorId: visitor.id }
    });

    if (!attendance || attendance.status !== "PRESENT") {
      return res.status(400).json({ message: "Presença não confirmada." });
    }

    // [INTEGRATION FIX] Check if Survey is required
    if (event.certificateRequiresSurvey) {
      const answersStart = await prisma.surveyResponse.count({
        where: {
          visitorId: visitor.id,
          surveyQuestion: { eventId: id }
        }
      });
      // Assuming if they answered at least one question, it's valid. 
      // Strictly we should check if they answered all *required* questions, but count > 0 is a good MVP check.
      if (answersStart === 0) {
        return res.status(403).json({
          message: "É necessário responder a pesquisa de satisfação para baixar o certificado.",
          code: "SURVEY_REQUIRED"
        });
      }
    }

    const pdfBuffer = await generateCertificateBuffer(
      visitor.name || "Visitante",
      event.title,
      event.startDate.toLocaleDateString("pt-BR"),
      event.tenant.name,
      attendance.id.split("-")[0].toUpperCase(),
      event.tenant.logoUrl,
      event.tenant.signatureUrl,
      event.tenant.certificateBackgroundUrl
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Certificado_${event.title.replace(/\s+/g, "_")}.pdf"`);
    return res.send(pdfBuffer);

  } catch (err) {
    console.error("Erro download certificado", err);
    return res.status(500).json({ message: "Erro ao baixar certificado" });
  }
});

// Enviar Certificado por Email
router.post("/:id/certificate", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    let { visitorId } = req.body;

    const event = await prisma.event.findUnique({
      where: { id },
      include: { tenant: true }
    });

    if (!event) {
      return res.status(404).json({ message: "Evento não encontrado" });
    }

    const isEventAdmin = user.role === Role.MASTER || (
      (user.role === Role.ADMIN || user.role === Role.PRODUCER || user.role === Role.COLLABORATOR) &&
      user.tenantId === event.tenantId
    );

    // If no visitorId, use authenticated user's visitor profile
    if (!visitorId) {
      const visitor = await prisma.visitor.findFirst({
        where: { email: user.email.toLowerCase(), tenantId: event.tenantId }
      });
      if (!visitor) {
        return res.status(404).json({ message: "Perfil de visitante não encontrado" });
      }
      visitorId = visitor.id;
    } else if (!isEventAdmin) {
      const visitor = await prisma.visitor.findFirst({
        where: { email: user.email.toLowerCase(), tenantId: event.tenantId }
      });
      if (!visitor || visitor.id !== visitorId) {
        return res.status(403).json({ message: "Sem permissao para solicitar certificado deste visitante" });
      }
    }

    // Verificar presença
    const attendance = await prisma.eventAttendance.findFirst({
      where: { eventId: id, visitorId }
    });

    if (!attendance || attendance.status !== "PRESENT") {
      return res.status(400).json({ message: "Visitante não participou do evento ou não fez check-in." });
    }

    // [INTEGRATION FIX] Check if Survey is required
    if (event.certificateRequiresSurvey) {
      const answersStart = await prisma.surveyResponse.count({
        where: {
          visitorId: visitorId,
          surveyQuestion: { eventId: id }
        }
      });
      if (answersStart === 0) {
        return res.status(403).json({
          message: "O visitante precisa responder a pesquisa de satisfação antes de receber o certificado.",
          code: "SURVEY_REQUIRED"
        });
      }
    }

    const visitor = await prisma.visitor.findUnique({ where: { id: visitorId } });
    if (!visitor || !visitor.email) {
      return res.status(400).json({ message: "Visitante inválido ou sem e-mail cadastrado." });
    }

    // Enviar e-mail with Verification Code
    const sent = await sendCertificateEmail(
      visitor.email,
      visitor.name || "Visitante",
      event.title,
      event.startDate.toLocaleDateString("pt-BR"),
      event.tenant.name,
      attendance.id.split("-")[0].toUpperCase(),
      event.tenant.logoUrl,
      event.tenant.signatureUrl,
      event.tenant.certificateBackgroundUrl
    );

    if (sent) {
      return res.json({ message: "Certificado enviado com sucesso!" });
    } else {
      return res.status(500).json({ message: "Falha ao enviar e-mail." });
    }

  } catch (err) {
    console.error("Erro certificado", err);
    return res.status(500).json({ message: "Erro ao gerar certificado" });
  }
});

// Register for Event (Sympla Killer)
router.post("/:id/register", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { ticketId, quantity, customFormData } = req.body;
    const user = req.user!;
    const requestedQuantity = Number(quantity);

    if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 10) {
      return res.status(400).json({ message: "Quantidade de ingressos invalida" });
    }

    // 1. Validate Event & Ticket
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ message: "Evento não encontrado" });

    // Race Condition Fix: Use Transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Re-fetch ticket inside transaction to get latest state (Pessimistic Lock)
      const tickets = await tx.$queryRaw<any[]>`SELECT * FROM "Ticket" WHERE id = ${ticketId} FOR UPDATE`;
      const ticket = tickets[0];
      if (!ticket) throw new Error("Ingresso não encontrado");

      if (ticket.eventId !== id) throw new Error("Ingresso inválido para este evento");

      // Clear expired registrations to free up stock
      const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
      await tx.registration.updateMany({
        where: {
          ticketId,
          status: "PENDING",
          createdAt: { lt: thirtyOneMinutesAgo }
        },
        data: { status: "CANCELED" }
      });

      // Count active pending registrations
      const activePendingCount = await tx.registration.count({
        where: {
          ticketId,
          status: "PENDING",
          createdAt: { gte: thirtyOneMinutesAgo }
        }
      });

      // Strict Stock Check
      if (ticket.sold + activePendingCount + requestedQuantity > ticket.quantity) {
        throw new Error("Ingressos esgotados (Overbooking prevented)");
      }

      // 2. Find Visitor
      const visitor = await tx.visitor.findFirst({
        where: { email: user.email.toLowerCase(), tenantId: event.tenantId }
      });
      if (!visitor) throw new Error("Perfil de visitante não encontrado");

      // 3. Create Registrations
      const isPaid = Number(ticket.price) > 0;
      const registrations = [];

      for (let i = 0; i < requestedQuantity; i++) {
        const code = `TKT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        const reg = await tx.registration.create({
          data: {
            eventId: id,
            ticketId,
            visitorId: visitor.id,
            guestName: visitor.name || "Visitante",
            guestEmail: visitor.email || user.email,
            code,
            status: isPaid ? "PENDING" : "CONFIRMED",
            pricePaid: Number(ticket.price),
            customFormData: customFormData || undefined
          }
        });
        registrations.push(reg);
      }

      // 4. Atomic Increment (somente para ingressos GRATUITOS; pagos incrementam no webhook)
      if (!isPaid) {
        await tx.ticket.update({
          where: { id: ticketId },
          data: { sold: { increment: requestedQuantity } }
        });
      }

      return { registrations, isPaid, ticketName: ticket.name, eventTitle: event.title, totalAmount: Number(ticket.price) * requestedQuantity };
    });

    if (result.isPaid) {
      try {
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        
        // 1. Identify recipient Stripe Connect Account (either producer or tenant)
        let stripeConnectId: string | null = null;
        if (event.producerId) {
          const prod = await prisma.user.findUnique({ where: { id: event.producerId } });
          if (prod?.stripeConnectId) stripeConnectId = prod.stripeConnectId;
        }
        if (!stripeConnectId) {
          const tenant = await prisma.tenant.findUnique({ where: { id: event.tenantId } });
          if (tenant?.stripeConnectId) stripeConnectId = tenant.stripeConnectId;
        }

        if (!stripeConnectId) {
          await prisma.registration.updateMany({
            where: { id: { in: result.registrations.map(r => r.id) } },
            data: { status: "CANCELED" }
          });
          return res.status(400).json({ 
            message: "Este evento não possui uma conta Stripe Connect vinculada para receber pagamentos." 
          });
        }

        const customerId = await stripeService.createCustomer({
          name: user.name || "Visitante",
          email: user.email,
          userId: user.id
        });

        const amountInCents = Math.round(result.totalAmount * 100);
        // Sprint 15: Calcular taxa via Central de Taxas (Bilheteria)
        const feeResult = await getPlatformFee({
          tenantId: event.tenantId,
          sourceType: PlatformFeeSource.TICKET,
          amountCents: amountInCents
        });
        const appFeeInCents = feeResult.platformFeeCents;

        // 3. Create Stripe Checkout session with Connect Split
        const session = await stripeService.createSplitPaymentSession({
          customerId,
          amount: feeResult.buyerPaysCents, // BUYER paga base + taxa
          description: `Ingresso: ${result.eventTitle} - ${result.ticketName}`,
          connectedAccountId: stripeConnectId,
          applicationFeeAmount: appFeeInCents,
          successUrl: `${frontendUrl}/meus-ingressos?success=true`,
          cancelUrl: `${frontendUrl}/meus-ingressos?canceled=true`,
          metadata: {
            registrationIds: result.registrations.map(r => r.id).join(","),
            eventId: id
          }
        });

        // Update registrations with Stripe Session ID
        await prisma.registration.updateMany({
          where: { id: { in: result.registrations.map(r => r.id) } },
          data: { stripeCheckoutSessionId: session.id }
        });

        return res.status(201).json({
          message: "Inscrição pendente de pagamento",
          registration: result.registrations[0],
          registrations: result.registrations,
          payment: { checkoutUrl: session.url }
        });
      } catch (stripeErr) {
        console.error("Erro no checkout Stripe (Event Register):", stripeErr);
        // Compensacao: cancela inscricoes criadas para liberar estoque
        await prisma.registration.updateMany({
          where: { id: { in: result.registrations.map(r => r.id) } },
          data: { status: "CANCELED" }
        });
        return res.status(500).json({ message: "Erro ao gerar pagamento via Stripe" });
      }
    }

    return res.status(201).json({ 
      message: "Inscrição realizada!", 
      registration: result.registrations[0],
      registrations: result.registrations
    });

  } catch (err: unknown) {
    console.error("Erro inscrição evento", err);
    // Handle specific transaction errors
    const message = (err instanceof Error) ? err.message : "Erro ao realizar inscrição";
    return res.status(message.includes("esgotados") ? 400 : 500).json({ message });
  }
});

// ========== EVENT REPORT (Admin) ==========

}
