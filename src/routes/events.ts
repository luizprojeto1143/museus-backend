import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, softAuthMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { sendCertificateEmail, generateCertificateBuffer } from "../services/email.js";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { createEventSchema, updateEventSchema } from "../schemas/event.schema.js";

const router = Router();

// Lista eventos (Suporta Discovery Mode / Agenda Unificada)
router.get("/", softAuthMiddleware, async (req, res) => {
  try {
    const tenantId = req.query.tenantId as string | undefined;
    const { visibility, discovery, status } = req.query; // discovery=true ignores tenantId

    // Check authentication for role-based filtering
    const user = req.user;
    const isMaster = user?.role === Role.MASTER;
    const isTenantAdmin = user && (user.role === Role.ADMIN || user.role === Role.PRODUCER) && user.tenantId === tenantId;
    const hasPrivilege = isMaster || isTenantAdmin;

    let whereClause: import("@prisma/client").Prisma.EventWhereInput = {};

    // 1. Discovery Mode (Global Public Events) - ALWAYS STRICT
    if (discovery === 'true') {
      whereClause.visibility = 'PUBLIC';
      whereClause.status = 'PUBLISHED';
      whereClause.startDate = { gte: new Date() }; // Upcoming only by default
    }
    // 2. Tenant Scoped
    else {
      if (!tenantId) {
        return res.status(400).json({ message: "tenantId é obrigatório (ou use ?discovery=true)" });
      }
      whereClause.tenantId = tenantId;

      // PRIVILEGED ACCESS (Admin/Producer seeing their own tenant)
      if (hasPrivilege) {
        // If filters provided, respect them. 
        if (status) whereClause.status = status as string;
        if (visibility) whereClause.visibility = visibility as string;

        // If NO filters provided, we show EVERYTHING (Drafts, Private, etc.) 
        // This matches Admin Dashboard expectation.
      }
      // PUBLIC/VISITOR ACCESS
      else {
        // Strict safety defaults
        whereClause.status = 'PUBLISHED';
        whereClause.visibility = 'PUBLIC';

        // Visitors cannot override these via params
        if (status && status !== 'PUBLISHED') {
          // Return empty if they try to fish for DRAFTs
          return res.json({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });
        }
      }
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where: whereClause,
        include: {
          tenant: { select: { id: true, name: true, slug: true, type: true } }
        },
        orderBy: { startDate: "asc" },
        take: limit,
        skip: skip
      }),
      prisma.event.count({ where: whereClause })
    ]);

    return res.json({
      data: events,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Erro listar eventos", err);
    return res.status(500).json({ message: "Erro ao listar eventos" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });

    if (!event) {
      return res.status(404).json({ message: "Evento não encontrado" });
    }

    return res.json(event);
  } catch (err) {
    console.error("Erro ao buscar evento", err);
    return res.status(500).json({ message: "Erro ao buscar evento" });
  }
});

// Increment View Count
router.post("/:id/view", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.event.update({
      where: { id },
      data: { views: { increment: 1 } }
    });
    return res.status(200).send();
  } catch (err) {
    // Silent fail for analytics
    console.error("Erro increment view", err);
    return res.status(200).send();
  }
});

// CRUD Admin
router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), validate(createEventSchema), async (req, res) => {
  try {
    const user = req.user!;
    const tenantId = user.role === Role.MASTER ? (req.body.tenantId as string) : user.tenantId;
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }

    interface EventBody {
      title: string;
      description?: string;
      location?: string;
      startDate: string;
      endDate?: string;
      categoryId?: string;
    }

    const {
      title, description, location, startDate, endDate, categoryId,
      certificateBackgroundUrl, certificateText, minMinutesForCertificate,
      // New fields
      format, visibility, isOnline,
      zipCode, address, number, complement, neighborhood, city, state,
      meetingLink, platform,
      producerName, producerDescription, producerLogoUrl, coverImageUrl,
      // Sympla Killer Features 🚀
      customFormSchema, galleryUrls,
      certificateRequiresSurvey,
      // Media - Audio Guide
      audioUrl, videoUrl
    } = req.body;

    // Validate categoryId if provided
    if (categoryId && categoryId !== "") {
      const categoryExists = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!categoryExists) {
        return res.status(400).json({ message: "Categoria não encontrada. Selecione uma categoria válida." });
      }
    }

    const event = await prisma.event.create({
      data: {
        title,
        description,
        location, // Used as venue name
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        categoryId: categoryId && categoryId !== "" ? categoryId : null,
        certificateBackgroundUrl,
        certificateText,
        minMinutesForCertificate: minMinutesForCertificate ? Number(minMinutesForCertificate) : null,

        // New fields
        format,
        visibility,
        isOnline: Boolean(isOnline),
        zipCode,
        address,
        number,
        complement,
        neighborhood,
        city,
        state,
        meetingLink,
        platform,
        producerName,
        producerDescription,
        producerLogoUrl,
        coverImageUrl,
        // Sympla Killer Features
        customFormSchema,
        galleryUrls: galleryUrls ? JSON.stringify(galleryUrls) : null, // Ensure string if SQLite, or use proper JSON handling

        surveyQuestions: undefined, // Ignored in creation here usually
        certificateRequiresSurvey: Boolean(certificateRequiresSurvey),

        // Media - Audio Guide
        audioUrl,
        videoUrl,

        tenant: { connect: { id: tenantId } }
      }
    });

    return res.status(201).json(event);
  } catch (err) {
    console.error("Erro criar evento", err);
    return res.status(500).json({ message: "Erro ao criar evento" });
  }
});

router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), validate(updateEventSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, description, location, startDate, endDate, categoryId,
      certificateBackgroundUrl, certificateText, minMinutesForCertificate,
      format, visibility, isOnline,
      zipCode, address, number, complement, neighborhood, city, state,
      meetingLink, platform,
      coverImageUrl,
      // Sympla Killer Features
      customFormSchema, galleryUrls,
      // New
      certificateRequiresSurvey,
      // Media - Audio Guide
      audioUrl, videoUrl
    } = req.body;

    const event = await prisma.event.update({
      where: { id },
      data: {
        title, description, location,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        categoryId: categoryId || null,
        certificateBackgroundUrl, certificateText,
        minMinutesForCertificate: minMinutesForCertificate ? Number(minMinutesForCertificate) : null,

        format, visibility, isOnline,
        zipCode, address, number, complement, neighborhood, city, state,
        meetingLink, platform,

        certificateRequiresSurvey: certificateRequiresSurvey !== undefined ? Boolean(certificateRequiresSurvey) : undefined,

        coverImageUrl,
        // Sympla Killer Features
        customFormSchema,
        galleryUrls: galleryUrls ? JSON.stringify(galleryUrls) : undefined,

        // Media - Audio Guide
        audioUrl,
        videoUrl
      }
    });

    return res.json(event);
  } catch (err) {
    console.error("Erro atualizar evento", err);
    return res.status(500).json({ message: "Erro ao atualizar evento" });
  }
});

router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.event.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    console.error("Erro excluir evento", err);
    return res.status(500).json({ message: "Erro ao excluir evento" });
  }
});

// Check check-in status
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
    const isPrivileged = user.role === Role.ADMIN || user.role === Role.MASTER || user.role === Role.PRODUCER;

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
      await prisma.registration.updateMany({
        where: { eventId: id, visitorId: targetVisitorId, status: "CONFIRMED" },
        data: { status: "CHECKED_IN", checkInDate: new Date() }
      });

      // Add XP logic if check-in successful (first time)
      await prisma.$transaction([
        prisma.visitorVisit.create({
          data: {
            visitorId: targetVisitorId,
            eventId: id,
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
        const { CertificateEngine } = await import('../services/certificate-engine.js');
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
      // @ts-ignore - Prisma error types are tricky to import generically without dedicated helper
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
          question: { eventId: id }
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

    // If no visitorId, use authenticated user's visitor profile
    if (!visitorId) {
      const visitor = await prisma.visitor.findFirst({
        where: { email: user.email.toLowerCase(), tenantId: event.tenantId }
      });
      if (!visitor) {
        return res.status(404).json({ message: "Perfil de visitante não encontrado" });
      }
      visitorId = visitor.id;
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
          question: { eventId: id }
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

    // 1. Validate Event & Ticket
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ message: "Evento não encontrado" });

    // Race Condition Fix: Use Transaction! 🛡️
    const result = await prisma.$transaction(async (tx) => {
      // 1. Re-fetch ticket inside transaction to get latest state
      const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket) throw new Error("Ingresso não encontrado");

      if (ticket.eventId !== id) throw new Error("Ingresso inválido para este evento");

      // Strict Stock Check
      if (ticket.sold + quantity > ticket.quantity) {
        throw new Error("Ingressos esgotados (Overbooking prevented)");
      }

      // 2. Find Visitor
      const visitor = await tx.visitor.findFirst({
        where: { email: user.email, tenantId: event.tenantId }
      });
      if (!visitor) throw new Error("Perfil de visitante não encontrado");

      // 3. Create Registration
      const code = `TKT-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

      const registration = await tx.registration.create({
        data: {
          eventId: id,
          ticketId,
          visitorId: visitor.id,
          guestName: visitor.name || "Visitante",
          guestEmail: visitor.email || user.email,
          code,
          status: "CONFIRMED",
          pricePaid: Number(ticket.price),
          customFormData: customFormData || undefined
        }
      });

      // 4. Atomic Increment
      await tx.ticket.update({
        where: { id: ticketId },
        data: { sold: { increment: quantity } }
      });

      return registration;
    });

    return res.status(201).json({ message: "Inscrição realizada!", registration: result });

  } catch (err: unknown) {
    console.error("Erro inscrição evento", err);
    // Handle specific transaction errors
    const message = (err instanceof Error) ? err.message : "Erro ao realizar inscrição";
    return res.status(message.includes("esgotados") ? 400 : 500).json({ message });
  }
});

// ========== EVENT REPORT (Admin) ==========
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
            responses: true
          },
          orderBy: { order: "asc" }
        }
      }
    });

    if (!event) {
      return res.status(404).json({ error: "Evento não encontrado" });
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
      const responses = q.responses;
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
        q.responses.map(r => parseFloat(r.answer)).filter(n => !isNaN(n))
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
            q.responses.map(r => r.visitorId || r.guestEmail)
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

export default router;
