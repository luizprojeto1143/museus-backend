import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware, softAuthMiddleware, requireRole, requirePermission } from "../../middleware/auth.js";
import { Role } from "@prisma/client";
import { sendCertificateEmail, generateCertificateBuffer } from "../../services/email.js";
import { z } from "zod";
import { createAuditLog } from "../governance/audit.js";
import { validate } from "../../middleware/validate.js";
import { createEventSchema, updateEventSchema } from "../../schemas/event.schema.js";
import { stripe, stripeService } from "../../services/stripeService.js";
import { dispatchEvent, backgroundQueue } from "../../infrastructure/queue/bullmq.setup.js";

const router = Router();

// Lista eventos (Suporta Discovery Mode / Agenda Unificada)
router.get("/", softAuthMiddleware, async (req, res) => {
  try {
    const tenantId = (req as any).tenantId || req.query.tenantId;
    const { visibility, discovery, status, equipamentoId, cityId } = req.query; // discovery=true ignores tenantId

    // Check authentication for role-based filtering
    const user = req.user;
    const isMaster = user?.role === Role.MASTER;
    const isTenantAdmin = user && (user.role === Role.ADMIN || user.role === Role.PRODUCER || user.role === Role.COLLABORATOR) && user.tenantId === tenantId;
    const hasPrivilege = isMaster || isTenantAdmin;

    const whereClause: import("@prisma/client").Prisma.EventWhereInput = { deletedAt: null };

    // 1. Discovery Mode (Global Public Events) - ALWAYS STRICT
    if (discovery === 'true') {
      whereClause.visibility = 'PUBLIC';
      whereClause.status = 'PUBLISHED';
      whereClause.startDate = { gte: new Date() }; // Upcoming only by default
      if (equipamentoId) whereClause.equipamentoId = equipamentoId as string;
      if (cityId) {
        whereClause.tenant = { parentId: cityId as string };
      }
    }
    // 2. Tenant Scoped
    else {
      if (!tenantId) {
        return res.status(400).json({ message: "tenantId é obrigatório (ou use ?discovery=true)" });
      }
      // Se for listagem do tenant, deve incluir ele e os filhos (para secretarias visualizarem tudo)
      whereClause.OR = [
        { tenantId: tenantId as string },
        { tenant: { parentId: tenantId as string } }
      ];
      if (equipamentoId) whereClause.equipamentoId = equipamentoId as string;

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
    const tenantId = req.query.tenantId as string | undefined;

    const whereClause: any = { id, deletedAt: null };
    if (tenantId && tenantId !== 'undefined' && tenantId !== 'null') {
      whereClause.tenantId = tenantId;
    }

    const event = await prisma.event.findFirst({
      where: whereClause,
      include: {
        tenant: {
          select: { id: true, name: true, slug: true }
        },
        _count: {
          select: {
            registrations: { where: { status: { in: ['CONFIRMED', 'CHECKED_IN'] } } }
          }
        }
      }
    });

    if (!event) {
      return res.status(404).json({ message: "Evento não encontrado ou acesso não autorizado" });
    }

    // Attach social proof count to root for easier access
    const responseData = {
      ...event,
      confirmedCount: event._count.registrations
    };

    return res.json(responseData);
  } catch (err) {
    console.error("Erro ao buscar evento", err);
    return res.status(500).json({ message: "Erro ao buscar evento" });
  }
});

// Increment View Count
router.post("/:id/view", async (req, res) => {
  try {
    const { id } = req.params;
    // Event-Driven: Não trava o banco com lock em update pesado
    await dispatchEvent(backgroundQueue, 'IncrementViews', { eventId: id, count: 1 });
    return res.status(200).send();
  } catch (err) {
    // Silent fail for analytics
    console.error("Erro increment view", err);
    return res.status(200).send();
  }
});

// CRUD Admin
router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER, Role.COLLABORATOR]), requirePermission("manage_events"), validate(createEventSchema), async (req, res) => {
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
      type, instructor, materials,

      format, visibility, isOnline,
      zipCode, address, number, complement, neighborhood, city, state,
      meetingLink, platform,
      producerName, producerDescription, producerLogoUrl, coverImageUrl,
      // Sympla Killer Features 🚀
      customFormSchema, galleryUrls,
      certificateRequiresSurvey,
      // Media - Audio Guide
      audioUrl, videoUrl,
      // Space Link
      spaceId,
      // Equipment Link
      equipamentoId
    } = req.body;

    // Validate categoryId if provided
    if (categoryId && categoryId !== "") {
      const categoryExists = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!categoryExists) {
        return res.status(400).json({ message: "Categoria não encontrada. Selecione uma categoria válida." });
      }
    }

    // Validate Space and Conflicts
    if (spaceId) {
      const space = await prisma.space.findUnique({ where: { id: spaceId } });
      if (!space || (space.tenantId !== tenantId)) {
        return res.status(404).json({ message: "Espaço não encontrado" });
      }

      // Check conflicts in Bookings
      const conflicts = await prisma.booking.count({
        where: {
          spaceId,
          status: { not: "CANCELLED" },
          AND: [
            { startTime: { lt: new Date(endDate || startDate) } },
            { endTime: { gt: new Date(startDate) } }
          ]
        }
      });

      if (conflicts > 0) {
        return res.status(409).json({ message: "Este espaço já está reservado por outro compromisso neste horário." });
      }
    }

    const event = await prisma.event.create({
      data: {
        title,
        description,
        location, // Used as venue name
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        category: categoryId && categoryId !== "" ? { connect: { id: String(categoryId) } } : undefined,
        certificateBackgroundUrl: certificateBackgroundUrl ? String(certificateBackgroundUrl) : null,
        certificateText: certificateText ? String(certificateText) : null,
        minMinutesForCertificate: minMinutesForCertificate ? Number(minMinutesForCertificate) : null,
        user: user.role === "PRODUCER" ? { connect: { id: user.id } } : undefined,

        // New fields
        type: type || "OTHER",
        instructor,
        materials,

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
        audioUrl: audioUrl ? String(audioUrl) : null,
        videoUrl: videoUrl ? String(videoUrl) : null,

        space: spaceId ? { connect: { id: String(spaceId) } } : undefined,
        equipamentoCultural: equipamentoId ? { connect: { id: String(equipamentoId) } } : undefined,

        tenant: { connect: { id: String(tenantId) } }
      }
    });

    return res.status(201).json(event);
  } catch (err) {
    console.error("Erro criar evento", err);
    return res.status(500).json({ message: "Erro ao criar evento" });
  }
});

router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER, Role.COLLABORATOR]), requirePermission("manage_events"), validate(updateEventSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    // IDOR Protection: Verify resource belongs to user's tenant
    const ownerCheck = user.role === Role.MASTER
      ? { id }
      : { id, tenantId: user.tenantId as string };
    const existingEvent = await prisma.event.findFirst({ where: ownerCheck });
    if (!existingEvent) {
      return res.status(404).json({ message: "Evento não encontrado" });
    }
    const {
      title, description, location, startDate, endDate, categoryId,
      certificateBackgroundUrl, certificateText, minMinutesForCertificate,
      // New fields - Workshop
      type, instructor, materials,

      format, visibility, isOnline,
      zipCode, address, number, complement, neighborhood, city, state,
      meetingLink, platform,
      coverImageUrl,
      // Sympla Killer Features
      customFormSchema, galleryUrls,
      // New
      certificateRequiresSurvey,
      // Media - Audio Guide
      audioUrl, videoUrl,
      // Space Link
      spaceId,
      // Equipment Link
      equipamentoId
    } = req.body;

    // Validate Space and Conflicts if changed
    if (spaceId) {
      const space = await prisma.space.findUnique({ where: { id: spaceId } });
      if (!space) return res.status(404).json({ message: "Espaço não encontrado" });

      const conflicts = await prisma.booking.count({
        where: {
          spaceId,
          status: { not: "CANCELLED" },
          AND: [
            { startTime: { lt: new Date(endDate || startDate) } },
            { endTime: { gt: new Date(startDate) } }
          ]
        }
      });

      if (conflicts > 0) {
        return res.status(409).json({ message: "Este espaço já está reservado neste horário." });
      }
    }

    // Storage Cleanup: Delete old files if they were replaced
    const { deleteFromStorage } = await import("../../routes/upload.js");
    if (coverImageUrl && coverImageUrl !== existingEvent.coverImageUrl && existingEvent.coverImageUrl) deleteFromStorage(existingEvent.coverImageUrl).catch(console.error);
    if (audioUrl && audioUrl !== existingEvent.audioUrl && existingEvent.audioUrl) deleteFromStorage(existingEvent.audioUrl).catch(console.error);
    if (videoUrl && videoUrl !== existingEvent.videoUrl && existingEvent.videoUrl) deleteFromStorage(existingEvent.videoUrl).catch(console.error);

    const event = await prisma.event.update({
      where: { id },
      data: {
        title, description, location,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        categoryId: categoryId || null,
        certificateBackgroundUrl, certificateText,
        minMinutesForCertificate: minMinutesForCertificate ? Number(minMinutesForCertificate) : null,

        // Workshop
        type, instructor, materials,

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
        videoUrl,

        spaceId: spaceId || undefined,
        equipamentoId: equipamentoId !== undefined ? equipamentoId : undefined
      }
    });

    return res.json(event);
  } catch (err) {
    console.error("Erro atualizar evento", err);
    return res.status(500).json({ message: "Erro ao atualizar evento" });
  }
});

router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER, Role.COLLABORATOR]), requirePermission("manage_events"), async (req, res) => {
  try {
    const { id } = req.params;
    const { hard } = req.query;
    const user = req.user!;

    // IDOR Protection: Verify resource belongs to user's tenant
    const whereClause = user.role === Role.MASTER
      ? { id }
      : { id, tenantId: user.tenantId as string };
    const existing = await prisma.event.findFirst({ where: whereClause });
    if (!existing) {
      return res.status(404).json({ message: "Evento não encontrado" });
    }

    const isMaster = user.role === Role.MASTER;
    const shouldHardDelete = isMaster && hard === "true";

    // C-01: Check for impact before deletion
    const ticketCount = await prisma.ticket.count({ where: { eventId: id } });
    const registrationCount = await prisma.registration.count({ where: { eventId: id } });

    if (registrationCount > 0 && !shouldHardDelete) {
      return res.status(400).json({ 
        message: `Não é possível excluir este evento pois existem ${registrationCount} inscrições. Considere arquivar o evento em vez de excluí-lo.` 
      });
    }

    if (shouldHardDelete) {
      // Permanent Delete (Hard)
      await prisma.event.delete({ where: { id } });

      // Cleanup files from R2
      const { deleteFromStorage } = await import("../../routes/upload.js");
      if (existing.coverImageUrl) deleteFromStorage(existing.coverImageUrl).catch(console.error);
      if (existing.audioUrl) deleteFromStorage(existing.audioUrl).catch(console.error);
      if (existing.videoUrl) deleteFromStorage(existing.videoUrl).catch(console.error);
      
      console.log(`[Event] Hard deleted event ${id} by MASTER`);
    } else {
      // Soft Delete
      await prisma.event.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'CANCELED' }
      });
      console.log(`[Event] Soft deleted event ${id}`);
    }

    await createAuditLog(
      shouldHardDelete ? 'HARD_DELETE' : 'SOFT_DELETE',
      'Event',
      id,
      user.id,
      user.email,
      existing.tenantId,
      existing,
      null,
      req
    );

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

    // 1. Validate Event & Ticket
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ message: "Evento não encontrado" });

    // Race Condition Fix: Use Transaction! 🛡️
    const result = await prisma.$transaction(async (tx) => {
      // 1. Re-fetch ticket inside transaction to get latest state (Pessimistic Lock)
      const tickets = await tx.$queryRaw<any[]>`SELECT * FROM "Ticket" WHERE id = ${ticketId} FOR UPDATE`;
      const ticket = tickets[0];
      if (!ticket) throw new Error("Ingresso não encontrado");

      if (ticket.eventId !== id) throw new Error("Ingresso inválido para este evento");

      // Strict Stock Check
      if (ticket.sold + quantity > ticket.quantity) {
        throw new Error("Ingressos esgotados (Overbooking prevented)");
      }

      // 2. Find Visitor
      const visitor = await tx.visitor.findFirst({
        where: { email: user.email.toLowerCase(), tenantId: event.tenantId }
      });
      if (!visitor) throw new Error("Perfil de visitante não encontrado");

      // 3. Create Registration
      const code = `TKT-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
      const isPaid = Number(ticket.price) > 0;

      const registration = await tx.registration.create({
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

      // 4. Atomic Increment
      await tx.ticket.update({
        where: { id: ticketId },
        data: { sold: { increment: quantity } }
      });

      return { registration, isPaid, ticketName: ticket.name, eventTitle: event.title, totalAmount: Number(ticket.price) * quantity };
    });

    if (result.isPaid) {
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
      // Taxa dinâmica: lê do tenant (fallback 5%)
      const eventTenant = await prisma.tenant.findUnique({ where: { id: event.tenantId }, select: { feePercentage: true } });
      const feeRate = (eventTenant?.feePercentage ?? 5) / 100;
      const appFeeInCents = Math.round(amountInCents * feeRate);

      // 3. Create Stripe Checkout session with Connect Split
      const session = await stripeService.createSplitPaymentSession({
        customerId,
        amount: amountInCents,
        description: `Ingresso: ${result.eventTitle} - ${result.ticketName}`,
        connectedAccountId: stripeConnectId,
        applicationFeeAmount: appFeeInCents,
        successUrl: `${frontendUrl}/meus-ingressos?success=true`,
        cancelUrl: `${frontendUrl}/meus-ingressos?canceled=true`,
        metadata: {
          registrationId: result.registration.id,
          eventId: id
        }
      });

      // Update registration with Stripe Session ID
      await prisma.registration.update({
        where: { id: result.registration.id },
        data: { stripeCheckoutSessionId: session.id }
      });

      return res.status(201).json({
        message: "Inscrição pendente de pagamento",
        registration: result.registration,
        payment: { checkoutUrl: session.url }
      });
    }

    return res.status(201).json({ message: "Inscrição realizada!", registration: result.registration });

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
            surveyResponses: true
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

    if (!ticketId || !quantity || !paymentMethod) {
      return res.status(400).json({ message: "Faltam parâmetros obrigatórios." });
    }

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ message: "Evento não encontrado" });

    // Validate Authorization
    if (user.role !== "MASTER" && event.tenantId !== user.tenantId) {
      return res.status(403).json({ message: "Sem permissão para vender neste evento" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket) throw new Error("Ingresso não encontrado");
      if (ticket.eventId !== id) throw new Error("Ingresso inválido para este evento");
      
      if (ticket.sold + quantity > ticket.quantity) {
        throw new Error("Estoque de ingressos insuficiente.");
      }

      // Generate tickets
      const registrations = [];
      for (let i = 0; i < quantity; i++) {
        const code = `PDV-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
        
        const registration = await tx.registration.create({
          data: {
            eventId: id,
            ticketId,
            guestName: "Visitante PDV", // PDV tickets are anonymous initially
            guestEmail: "pdv@local",
            code,
            status: "CONFIRMED", // Confirmed automatically since payment is physically received
            pricePaid: Number(ticket.price)
          }
        });
        registrations.push(registration);
      }

      // Update Stock
      await tx.ticket.update({
        where: { id: ticketId },
        data: { sold: { increment: quantity } }
      });

      return { registrations, total: Number(ticket.price) * quantity };
    });

    return res.json({ success: true, ...result });

  } catch (err: any) {
    console.error("Erro no PDV Sell", err);
    return res.status(400).json({ message: err.message || "Erro na venda física." });
  }
});

export default router;
