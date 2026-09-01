import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../../prisma.js";
import { authMiddleware, softAuthMiddleware, requireRole, requirePermission } from "../../middleware/auth.js";
import { resolveCatalogTenantId } from "../../utils/catalogTenant.js";
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

const router = Router();

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

router.get("/", softAuthMiddleware, async (req, res) => {
  try {
    const { visibility, discovery, status, equipamentoId, cityId } = req.query;
    let tenantId = (req as any).tenantId || req.query.tenantId;
    const user = req.user;
    const isMaster = user?.role === Role.MASTER;
    const whereClause: import("@prisma/client").Prisma.EventWhereInput = { deletedAt: null };
    if (discovery === 'true') {
      whereClause.visibility = 'PUBLIC';
      whereClause.status = 'PUBLISHED';
      whereClause.startDate = { gte: new Date() };
      if (equipamentoId) whereClause.equipamentoId = equipamentoId as string;
      if (cityId) {
        whereClause.tenant = { parentId: cityId as string };
      }
    } else {
      const catalogTenant = await resolveCatalogTenantId(req);
      if (!catalogTenant.ok) {
        return res.status(catalogTenant.status).json({
          message: catalogTenant.message === "tenantId é obrigatório"
            ? "tenantId é obrigatório (ou use ?discovery=true)"
            : catalogTenant.message
        });
      }
      tenantId = catalogTenant.tenantId;
      const isTenantAdminResolved = Boolean(user && (user.role === Role.ADMIN || user.role === Role.PRODUCER || user.role === Role.COLLABORATOR) && user.tenantId === tenantId);
      const hasPrivilegeResolved = Boolean(isMaster || isTenantAdminResolved);
      whereClause.OR = [
        { tenantId: tenantId as string },
        { tenant: { parentId: tenantId as string } }
      ];
      if (equipamentoId) whereClause.equipamentoId = equipamentoId as string;
      if (hasPrivilegeResolved) {
        if (status) whereClause.status = status as string;
        if (visibility) whereClause.visibility = visibility as string;
      } else {
        whereClause.status = 'PUBLISHED';
        whereClause.visibility = 'PUBLIC';
        if (status && status !== 'PUBLISHED') {
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
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
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
        tenant: { select: { id: true, name: true, slug: true } },
        _count: { select: { registrations: { where: { status: { in: ['CONFIRMED', 'CHECKED_IN'] } } } } }
      }
    });
    if (!event) {
      return res.status(404).json({ message: "Evento não encontrado ou acesso não autorizado" });
    }
    return res.json({ ...event, confirmedCount: event._count.registrations });
  } catch (err) {
    console.error("Erro ao buscar evento", err);
    return res.status(500).json({ message: "Erro ao buscar evento" });
  }
});

router.post("/:id/view", async (req, res) => {
  try {
    const { id } = req.params;
    await dispatchEvent(backgroundQueue, 'IncrementViews', { eventId: id, count: 1 });
    return res.status(200).send();
  } catch (err) {
    console.error("Erro increment view", err);
    return res.status(200).send();
  }
});

router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER, Role.COLLABORATOR]), requirePermission("manage_events"), validate(createEventSchema), async (req, res) => {
  try {
    const user = req.user!;
    const tenantId = user.role === Role.MASTER ? (req.body.tenantId as string) : user.tenantId;
    if (!tenantId) return res.status(400).json({ message: "tenantId é obrigatório" });
    const {
      title, description, location, startDate, endDate, categoryId,
      certificateBackgroundUrl, certificateText, minMinutesForCertificate,
      type, instructor, materials, format, visibility, isOnline,
      zipCode, address, number, complement, neighborhood, city, state,
      meetingLink, platform, producerName, producerDescription, producerLogoUrl, coverImageUrl,
      customFormSchema, galleryUrls, certificateRequiresSurvey, audioUrl, videoUrl, spaceId, equipamentoId
    } = req.body;
    if (categoryId && categoryId !== "") {
      const categoryExists = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!categoryExists) return res.status(400).json({ message: "Categoria não encontrada. Selecione uma categoria válida." });
    }
    await validateEventRelations(tenantId, { categoryId, equipamentoId });
    if (spaceId) {
      const space = await prisma.space.findUnique({ where: { id: spaceId } });
      if (!space || (space.tenantId !== tenantId)) return res.status(404).json({ message: "Espaço não encontrado" });
      const conflicts = await prisma.booking.count({
        where: { spaceId, status: { not: "CANCELLED" }, AND: [{ startTime: { lt: new Date(endDate || startDate) } }, { endTime: { gt: new Date(startDate) } }] }
      });
      if (conflicts > 0) return res.status(409).json({ message: "Este espaço já está reservado por outro compromisso neste horário." });
    }
    const event = await prisma.event.create({
      data: {
        title, description, location,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        category: categoryId && categoryId !== "" ? { connect: { id: String(categoryId) } } : undefined,
        certificateBackgroundUrl: certificateBackgroundUrl ? String(certificateBackgroundUrl) : null,
        certificateText: certificateText ? String(certificateText) : null,
        minMinutesForCertificate: minMinutesForCertificate ? Number(minMinutesForCertificate) : null,
        user: user.role === "PRODUCER" ? { connect: { id: user.id } } : undefined,
        type: type || "OTHER", instructor, materials, format, visibility, isOnline: Boolean(isOnline),
        zipCode, address, number, complement, neighborhood, city, state, meetingLink, platform,
        producerName, producerDescription, producerLogoUrl, coverImageUrl, customFormSchema,
        galleryUrls: galleryUrls ? JSON.stringify(galleryUrls) : null,
        surveyQuestions: undefined, certificateRequiresSurvey: Boolean(certificateRequiresSurvey),
        audioUrl: audioUrl ? String(audioUrl) : null, videoUrl: videoUrl ? String(videoUrl) : null,
        space: spaceId ? { connect: { id: String(spaceId) } } : undefined,
        equipamentoCultural: equipamentoId ? { connect: { id: String(equipamentoId) } } : undefined,
        tenant: { connect: { id: String(tenantId) } }
      }
    });
    return res.status(201).json(event);
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("Erro criar evento", err);
    return res.status(500).json({ message: "Erro ao criar evento" });
  }
});

router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER, Role.COLLABORATOR]), requirePermission("manage_events"), validate(updateEventSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const existingEvent = await assertTenantOwnership({ model: 'event', id, user });
    const {
      title, description, location, startDate, endDate, categoryId,
      certificateBackgroundUrl, certificateText, minMinutesForCertificate,
      type, instructor, materials, format, visibility, isOnline,
      zipCode, address, number, complement, neighborhood, city, state,
      meetingLink, platform, coverImageUrl, customFormSchema, galleryUrls,
      certificateRequiresSurvey, audioUrl, videoUrl, spaceId, equipamentoId
    } = req.body;
    await validateEventRelations(existingEvent.tenantId, { categoryId, equipamentoId });
    if (spaceId) {
      const space = await prisma.space.findUnique({ where: { id: spaceId } });
      if (!space || space.tenantId !== existingEvent.tenantId) return res.status(404).json({ message: "Espaco nao encontrado" });
      const conflictStart = startDate ? new Date(startDate) : existingEvent.startDate;
      const conflictEnd = endDate ? new Date(endDate) : (existingEvent.endDate || conflictStart);
      const conflicts = await prisma.booking.count({
        where: { eventId: { not: id }, spaceId, status: { not: "CANCELLED" }, AND: [{ startTime: { lt: conflictEnd } }, { endTime: { gt: conflictStart } }] }
      });
      if (conflicts > 0) return res.status(409).json({ message: "Este espaço já está reservado neste horário." });
    }
    const { deleteFromStorage } = await import("../../routes/upload.js");
    if (coverImageUrl && coverImageUrl !== existingEvent.coverImageUrl && existingEvent.coverImageUrl) deleteFromStorage(existingEvent.coverImageUrl).catch(console.error);
    if (audioUrl && audioUrl !== existingEvent.audioUrl && existingEvent.audioUrl) deleteFromStorage(existingEvent.audioUrl).catch(console.error);
    if (videoUrl && videoUrl !== existingEvent.videoUrl && existingEvent.videoUrl) deleteFromStorage(existingEvent.videoUrl).catch(console.error);
    const event = await prisma.event.update({
      where: { id },
      data: {
        title, description, location, startDate: new Date(startDate), endDate: endDate ? new Date(endDate) : null,
        categoryId: categoryId || null, certificateBackgroundUrl, certificateText,
        minMinutesForCertificate: minMinutesForCertificate ? Number(minMinutesForCertificate) : null,
        type, instructor, materials, format, visibility, isOnline, zipCode, address, number, complement, neighborhood, city, state,
        meetingLink, platform, certificateRequiresSurvey: certificateRequiresSurvey !== undefined ? Boolean(certificateRequiresSurvey) : undefined,
        coverImageUrl, customFormSchema, galleryUrls: galleryUrls ? JSON.stringify(galleryUrls) : undefined,
        audioUrl, videoUrl, spaceId: spaceId || undefined, equipamentoId: equipamentoId !== undefined ? equipamentoId : undefined
      }
    });
    return res.json(event);
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("Erro atualizar evento", err);
    return res.status(500).json({ message: "Erro ao atualizar evento" });
  }
});

router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER, Role.COLLABORATOR]), requirePermission("manage_events"), async (req, res) => {
  try {
    const { id } = req.params;
    const { hard } = req.query;
    const user = req.user!;
    const existing = await assertTenantOwnership({ model: 'event', id, user });
    const isMaster = user.role === Role.MASTER;
    const shouldHardDelete = isMaster && hard === "true";
    const registrationCount = await prisma.registration.count({ where: { eventId: id } });
    if (registrationCount > 0 && !shouldHardDelete) {
      return res.status(400).json({ message: `Não é possível excluir este evento pois existem ${registrationCount} inscrições. Considere arquivar o evento em vez de excluí-lo.` });
    }
    if (shouldHardDelete) {
      await prisma.event.delete({ where: { id } });
      const { deleteFromStorage } = await import("../../routes/upload.js");
      if (existing.coverImageUrl) deleteFromStorage(existing.coverImageUrl).catch(console.error);
      if (existing.audioUrl) deleteFromStorage(existing.audioUrl).catch(console.error);
      if (existing.videoUrl) deleteFromStorage(existing.videoUrl).catch(console.error);
    } else {
      await prisma.event.update({ where: { id }, data: { deletedAt: new Date(), status: 'CANCELED' } });
    }
    await createAuditLog(shouldHardDelete ? 'HARD_DELETE' : 'SOFT_DELETE', 'Event', id, user.id, user.email, existing.tenantId, existing, null, req);
    return res.status(204).send();
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("Erro excluir evento", err);
    return res.status(500).json({ message: "Erro ao excluir evento" });
  }
});

router.get("/:id/my-attendance", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ message: "Evento não encontrado" });
    const visitor = await prisma.visitor.findFirst({ where: { email: user.email, tenantId: event.tenantId } });
    if (!visitor) return res.json({ attended: false });
    const attendance = await prisma.eventAttendance.findFirst({ where: { eventId: id, visitorId: visitor.id } });
    return res.json({ attended: !!attendance, attendance, visitorId: visitor.id });
  } catch (err) {
    console.error("Erro my-attendance", err);
    return res.status(500).json({ message: "Erro ao verificar presença" });
  }
});

router.post("/:id/checkin", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const isPrivileged = user.role === Role.ADMIN || user.role === Role.MASTER || user.role === Role.PRODUCER || (user.role === Role.COLLABORATOR && user.permissions?.manage_scanner);
    let visitorId: string | undefined = req.body.visitorId;
    let email: string | undefined = req.body.email;
    const event = await prisma.event.findUnique({ where: { id }, include: { tenant: true } });
    if (!event) return res.status(404).json({ message: "Evento não encontrado" });
    if (!isPrivileged) {
      const meVisitor = await prisma.visitor.findFirst({ where: { email: user.email, tenantId: event.tenantId } });
      if (!meVisitor) return res.status(403).json({ message: "Você não tem um perfil de visitante neste local." });
      visitorId = meVisitor.id;
      email = undefined;
    }
    if (!visitorId && !email) return res.status(400).json({ message: "É necessário informar visitorId ou email" });
    let targetVisitorId = visitorId;
    if (email) {
      const visitor = await prisma.visitor.findFirst({ where: { email, tenantId: event.tenantId } });
      if (!visitor) return res.status(404).json({ message: "Visitante não encontrado neste museu" });
      targetVisitorId = visitor.id;
    } else if (visitorId && isPrivileged) {
      const visitor = await prisma.visitor.findUnique({ where: { id: visitorId } });
      if (!visitor) return res.status(404).json({ message: "Visitante não encontrado" });
      targetVisitorId = visitor.id;
    }
    if (!targetVisitorId) return res.status(400).json({ message: "Visitante não identificado." });
    try {
      const attendance = await prisma.eventAttendance.create({
        data: { eventId: id, visitorId: targetVisitorId, status: "PRESENT", checkInTime: new Date() }
      });
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
          registrationId: registration.id, eventId: id, ticketId: registration.ticketId, code: registration.code,
          guestName: registration.guestName, guestEmail: registration.guestEmail, checkedInAt: new Date().toISOString(), source: "EVENT_CHECKIN"
        }).catch(err => console.error("Ticket checked-in webhook delivery failed:", err));
      }
      await prisma.$transaction([
        prisma.visitorVisit.create({ data: { visitorId: targetVisitorId, eventId: id, tenantId: event.tenantId, source: "CHECKIN", xpGained: 10 } }),
        prisma.visitor.update({ where: { id: targetVisitorId }, data: { xp: { increment: 10 } } })
      ]);
      try {
        const { CertificateEngine } = await import('../../services/certificate-engine.js');
        await CertificateEngine.evaluate('EVENT_ATTENDED', { tenantId: event.tenantId, visitorId: targetVisitorId, eventId: id });
        const updatedVisitor = await prisma.visitor.findUnique({ where: { id: targetVisitorId } });
        if (updatedVisitor) await CertificateEngine.evaluate('XP_THRESHOLD', { tenantId: event.tenantId, visitorId: targetVisitorId, newXp: updatedVisitor.xp });
      } catch (e) { console.error("Hook Error", e); }
      return res.json({ message: "Check-in realizado com sucesso", attendance });
    } catch (err: unknown) {
      if ((err as any)?.code === 'P2002') {
        const existing = await prisma.eventAttendance.findFirst({ where: { eventId: id, visitorId: targetVisitorId } });
        return res.json({ message: "Check-in já realizado", attendance: existing });
      }
      throw err;
    }
  } catch (err) {
    console.error("Erro check-in critical", err);
    return res.status(500).json({ message: "Erro interno no check-in" });
  }
});

router.get("/:id/certificate/download", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const event = await prisma.event.findUnique({ where: { id }, include: { tenant: true } });
    if (!event) return res.status(404).json({ message: "Evento não encontrado" });
    const visitor = await prisma.visitor.findFirst({ where: { email: user.email, tenantId: event.tenantId } });
    if (!visitor) return res.status(404).json({ message: "Visitante não identificado" });
    const attendance = await prisma.eventAttendance.findFirst({ where: { eventId: id, visitorId: visitor.id } });
    if (!attendance || attendance.status !== "PRESENT") return res.status(400).json({ message: "Presença não confirmada." });
    if (event.certificateRequiresSurvey) {
      const answersStart = await prisma.surveyResponse.count({ where: { visitorId: visitor.id, surveyQuestion: { eventId: id } } });
      if (answersStart === 0) return res.status(403).json({ message: "É necessário responder a pesquisa de satisfação para baixar o certificado.", code: "SURVEY_REQUIRED" });
    }
    const pdfBuffer = await generateCertificateBuffer(
      visitor.name || "Visitante", event.title, event.startDate.toLocaleDateString("pt-BR"), event.tenant.name,
      attendance.id.split("-")[0].toUpperCase(), event.tenant.logoUrl, event.tenant.signatureUrl, event.tenant.certificateBackgroundUrl
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Certificado_${event.title.replace(/\s+/g, "_")}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("Erro download certificado", err);
    return res.status(500).json({ message: "Erro ao baixar certificado" });
  }
});

router.post("/:id/certificate", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    let { visitorId } = req.body;
    const event = await prisma.event.findUnique({ where: { id }, include: { tenant: true } });
    if (!event) return res.status(404).json({ message: "Evento não encontrado" });
    const isEventAdmin = user.role === Role.MASTER || ((user.role === Role.ADMIN || user.role === Role.PRODUCER || user.role === Role.COLLABORATOR) && user.tenantId === event.tenantId);
    if (!visitorId) {
      const visitor = await prisma.visitor.findFirst({ where: { email: user.email.toLowerCase(), tenantId: event.tenantId } });
      if (!visitor) return res.status(404).json({ message: "Perfil de visitante não encontrado" });
      visitorId = visitor.id;
    } else if (!isEventAdmin) {
      const visitor = await prisma.visitor.findFirst({ where: { email: user.email.toLowerCase(), tenantId: event.tenantId } });
      if (!visitor || visitor.id !== visitorId) return res.status(403).json({ message: "Sem permissao para solicitar certificado deste visitante" });
    }
    const attendance = await prisma.eventAttendance.findFirst({ where: { eventId: id, visitorId } });
    if (!attendance || attendance.status !== "PRESENT") return res.status(400).json({ message: "Visitante não participou do evento ou não fez check-in." });
    if (event.certificateRequiresSurvey) {
      const answersStart = await prisma.surveyResponse.count({ where: { visitorId: visitorId, surveyQuestion: { eventId: id } } });
      if (answersStart === 0) return res.status(403).json({ message: "O visitante precisa responder a pesquisa de satisfação antes de receber o certificado.", code: "SURVEY_REQUIRED" });
    }
    const visitor = await prisma.visitor.findUnique({ where: { id: visitorId } });
    if (!visitor || !visitor.email) return res.status(400).json({ message: "Visitante inválido ou sem e-mail cadastrado." });
    const sent = await sendCertificateEmail(
      visitor.email, visitor.name || "Visitante", event.title, event.startDate.toLocaleDateString("pt-BR"), event.tenant.name,
      attendance.id.split("-")[0].toUpperCase(), event.tenant.logoUrl, event.tenant.signatureUrl, event.tenant.certificateBackgroundUrl
    );
    if (sent) return res.json({ message: "Certificado enviado com sucesso!" });
    return res.status(500).json({ message: "Falha ao enviar e-mail." });
  } catch (err) {
    console.error("Erro certificado", err);
    return res.status(500).json({ message: "Erro ao gerar certificado" });
  }
});

router.post("/:id/register", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { ticketId, quantity, customFormData } = req.body;
    const user = req.user!;
    const requestedQuantity = Number(quantity);
    if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 10) {
      return res.status(400).json({ message: "Quantidade de ingressos invalida" });
    }
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ message: "Evento não encontrado" });
    const result = await prisma.$transaction(async (tx) => {
      const tickets = await tx.$queryRaw<any[]>`SELECT * FROM "Ticket" WHERE id = ${ticketId} FOR UPDATE`;
      const ticket = tickets[0];
      if (!ticket) throw new Error("Ingresso não encontrado");
      if (ticket.eventId !== id) throw new Error("Ingresso inválido para este evento");
      const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
      await tx.registration.updateMany({ where: { ticketId, status: "PENDING", createdAt: { lt: thirtyOneMinutesAgo } }, data: { status: "CANCELED" } });
      const activePendingCount = await tx.registration.count({ where: { ticketId, status: "PENDING", createdAt: { gte: thirtyOneMinutesAgo } } });
      if (ticket.sold + activePendingCount + requestedQuantity > ticket.quantity) throw new Error("Ingressos esgotados (Overbooking prevented)");
      const visitor = await tx.visitor.findFirst({ where: { email: user.email.toLowerCase(), tenantId: event.tenantId } });
      if (!visitor) throw new Error("Perfil de visitante não encontrado");
      const isPaid = Number(ticket.price) > 0;
      const registrations = [];
      for (let i = 0; i < requestedQuantity; i++) {
        const code = `TKT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        const reg = await tx.registration.create({
          data: { eventId: id, ticketId, visitorId: visitor.id, guestName: visitor.name || "Visitante", guestEmail: visitor.email || user.email, code, status: isPaid ? "PENDING" : "CONFIRMED", pricePaid: Number(ticket.price), customFormData: customFormData || undefined }
        });
        registrations.push(reg);
      }
      if (!isPaid) await tx.ticket.update({ where: { id: ticketId }, data: { sold: { increment: requestedQuantity } } });
      return { registrations, isPaid, ticketName: ticket.name, eventTitle: event.title, totalAmount: Number(ticket.price) * requestedQuantity };
    });
    if (result.isPaid) {
      try {
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
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
          await prisma.registration.updateMany({ where: { id: { in: result.registrations.map(r => r.id) } }, data: { status: "CANCELED" } });
          return res.status(400).json({ message: "Este evento não possui uma conta Stripe Connect vinculada para receber pagamentos." });
        }
        const customerId = await stripeService.createCustomer({ name: user.name || "Visitante", email: user.email, userId: user.id });
        const amountInCents = Math.round(result.totalAmount * 100);
        const feeResult = await getPlatformFee({ tenantId: event.tenantId, sourceType: PlatformFeeSource.TICKET, amountCents: amountInCents });
        const session = await stripeService.createSplitPaymentSession({
          customerId, amount: feeResult.buyerPaysCents, description: `Ingresso: ${result.eventTitle} - ${result.ticketName}`,
          connectedAccountId: stripeConnectId, applicationFeeAmount: feeResult.platformFeeCents,
          successUrl: `${frontendUrl}/meus-ingressos?success=true`, cancelUrl: `${frontendUrl}/meus-ingressos?canceled=true`,
          metadata: { registrationIds: result.registrations.map(r => r.id).join(","), eventId: id }
        });
        await prisma.registration.updateMany({ where: { id: { in: result.registrations.map(r => r.id) } }, data: { stripeCheckoutSessionId: session.id } });
        return res.status(201).json({ message: "Inscrição pendente de pagamento", registration: result.registrations[0], registrations: result.registrations, payment: { checkoutUrl: session.url } });
      } catch (stripeErr) {
        console.error("Erro no checkout Stripe (Event Register):", stripeErr);
        await prisma.registration.updateMany({ where: { id: { in: result.registrations.map(r => r.id) } }, data: { status: "CANCELED" } });
        return res.status(500).json({ message: "Erro ao gerar pagamento via Stripe" });
      }
    }
    return res.status(201).json({ message: "Inscrição realizada!", registration: result.registrations[0], registrations: result.registrations });
  } catch (err: unknown) {
    console.error("Erro inscrição evento", err);
    const message = (err instanceof Error) ? err.message : "Erro ao realizar inscrição";
    return res.status(message.includes("esgotados") ? 400 : 500).json({ message });
  }
});

router.get("/:id/report", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        tenant: { select: { name: true, slug: true } }, category: { select: { name: true } }, tickets: true,
        registrations: { include: { ticket: { select: { name: true, price: true } }, visitor: { select: { name: true, email: true, photoUrl: true } } }, orderBy: { createdAt: "desc" } },
        surveyQuestions: { include: { surveyResponses: true }, orderBy: { order: "asc" } }
      }
    });
    if (!event) return res.status(404).json({ error: "Evento não encontrado" });
    if (req.user!.role !== Role.MASTER && event.tenantId !== req.user!.tenantId) return res.status(403).json({ message: "Sem permissao para acessar este relatorio" });
    const totalRegistrations = event.registrations.length;
    const totalCheckedIn = event.registrations.filter(r => r.status === "CHECKED_IN").length;
    const attendanceRate = totalRegistrations > 0 ? Math.round((totalCheckedIn / totalRegistrations) * 100) : 0;
    const totalRevenue = event.registrations.reduce((sum, r) => sum + Number(r.pricePaid || 0), 0);
    const ticketsBreakdown = event.tickets.map(t => ({ id: t.id, name: t.name, quantity: t.quantity, sold: t.sold, available: t.quantity - t.sold, price: Number(t.price), revenue: t.sold * Number(t.price) }));
    const surveyResults = event.surveyQuestions.map(q => {
      const responses = q.surveyResponses;
      const totalResponses = responses.length;
      let aggregation: Record<string, unknown> = { count: totalResponses };
      if (q.type === "STARS" || q.type === "NPS") {
        const numericAnswers = responses.map(r => parseFloat(r.answer)).filter(n => !isNaN(n));
        const average = numericAnswers.length > 0 ? numericAnswers.reduce((a, b) => a + b, 0) / numericAnswers.length : 0;
        const distribution: Record<string, number> = {};
        numericAnswers.forEach(n => { const key = String(Math.round(n)); distribution[key] = (distribution[key] || 0) + 1; });
        aggregation = { average: Math.round(average * 10) / 10, distribution, count: numericAnswers.length };
        if (q.type === "NPS") {
          const promoters = numericAnswers.filter(n => n >= 9).length;
          const detractors = numericAnswers.filter(n => n <= 6).length;
          (aggregation as any).npsScore = totalResponses > 0 ? Math.round(((promoters - detractors) / totalResponses) * 100) : 0;
          (aggregation as any).promoters = promoters;
          (aggregation as any).detractors = detractors;
          (aggregation as any).passives = numericAnswers.length - promoters - detractors;
        }
      } else if (q.type === "CHOICE") {
        const distribution: Record<string, number> = {};
        responses.forEach(r => { distribution[r.answer] = (distribution[r.answer] || 0) + 1; });
        aggregation = { distribution, count: totalResponses };
      } else {
        aggregation = { recentAnswers: responses.slice(-5).map(r => r.answer), count: totalResponses };
      }
      return { id: q.id, question: q.question, type: q.type, options: q.options, totalResponses, aggregation };
    });
    const starsQuestions = event.surveyQuestions.filter(q => q.type === "STARS");
    let overallSatisfaction = 0;
    if (starsQuestions.length > 0) {
      const allStarsResponses = starsQuestions.flatMap(q => q.surveyResponses.map(r => parseFloat(r.answer)).filter(n => !isNaN(n)));
      if (allStarsResponses.length > 0) overallSatisfaction = Math.round((allStarsResponses.reduce((a, b) => a + b, 0) / allStarsResponses.length) * 10) / 10;
    }
    const participants = event.registrations.map(r => ({ id: r.id, name: r.guestName || r.visitor?.name || "Anônimo", email: r.guestEmail || r.visitor?.email || "", photoUrl: r.visitor?.photoUrl || null, ticketName: r.ticket.name, status: r.status, checkInDate: r.checkInDate, registeredAt: r.createdAt }));
    res.json({
      event: { id: event.id, title: event.title, description: event.description, startDate: event.startDate, endDate: event.endDate, location: event.location, format: event.format, category: event.category?.name || null, tenant: event.tenant.name },
      stats: { totalRegistrations, totalCheckedIn, attendanceRate, totalRevenue, ticketsBreakdown },
      survey: { questionsCount: event.surveyQuestions.length, totalResponses: surveyResults.reduce((sum, q) => sum + q.totalResponses, 0), uniqueRespondents: new Set(event.surveyQuestions.flatMap(q => q.surveyResponses.map(r => r.visitorId || r.guestEmail))).size, overallSatisfaction, questions: surveyResults },
      participants
    });
  } catch (error) {
    console.error("Error generating report:", error);
    res.status(500).json({ error: "Erro ao gerar relatório" });
  }
});

router.get("/pos/sessions", authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;
    if (!tenantId && user.role !== "MASTER") return res.status(400).json({ message: "TenantId não identificado para PDV" });
    const whereClause: any = { deletedAt: null, status: "PUBLISHED" };
    if (tenantId && user.role !== "MASTER") whereClause.OR = [{ tenantId: tenantId }, { tenant: { parentId: tenantId } }];
    const events = await prisma.event.findMany({
      where: whereClause,
      include: { space: true, _count: { select: { registrations: true, theaterSeatReservations: true } } },
      orderBy: { startDate: "asc" }
    });
    return res.json(events);
  } catch (err) {
    console.error("Erro fetching POS sessions", err);
    return res.status(500).json({ message: "Erro ao buscar sessões do PDV" });
  }
});

router.post("/:id/pos-sell", authMiddleware, requireRole([Role.ADMIN, Role.PRODUCER, Role.COLLABORATOR, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const { ticketId, quantity, paymentMethod } = req.body;
    const user = req.user!;
    const requestedQuantity = Number(quantity);
    if (!ticketId || !quantity || !paymentMethod) return res.status(400).json({ message: "Faltam parâmetros obrigatórios." });
    if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 50) return res.status(400).json({ message: "Quantidade de ingressos invalida" });
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ message: "Evento não encontrado" });
    if (user.role !== "MASTER" && event.tenantId !== user.tenantId) return res.status(403).json({ message: "Sem permissão para vender neste evento" });
    const result = await prisma.$transaction(async (tx) => {
      const tickets = await tx.$queryRaw<any[]>`SELECT * FROM "Ticket" WHERE id = ${ticketId} FOR UPDATE`;
      const ticket = tickets[0];
      if (!ticket) throw new Error("Ingresso não encontrado");
      if (ticket.eventId !== id) throw new Error("Ingresso inválido para este evento");
      if (ticket.sold + requestedQuantity > ticket.quantity) throw new Error("Estoque de ingressos insuficiente.");
      const amountCents = Math.round(Number(ticket.price) * requestedQuantity * 100);
      const feeResult = await getPlatformFee({ tenantId: event.tenantId, sourceType: PlatformFeeSource.TICKET, amountCents });
      const totalAmount = Number(ticket.price) * requestedQuantity;
      const totalFee = feeResult.platformFeeCents / 100;
      const finTx = await tx.financialTransaction.create({
        data: {
          tenantId: event.tenantId, type: "PAYMENT", source: "REGISTRATION", amount: totalAmount, fee: totalFee,
          netAmount: totalAmount - totalFee, status: "COMPLETED", paymentMethod: paymentMethod || "CASH",
          feeConfigId: feeResult.configId, platformFeePercent: feeResult.percentage, platformFeeAmountCents: feeResult.platformFeeCents, feePaidBy: feeResult.feePaidBy
        }
      });
      const registrations = [];
      for (let i = 0; i < requestedQuantity; i++) {
        const code = `PDV-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        const registration = await tx.registration.create({
          data: { eventId: id, ticketId, guestName: "Visitante PDV", guestEmail: "pdv@local", code, status: "CONFIRMED", pricePaid: Number(ticket.price), financialTransactionId: finTx.id }
        });
        registrations.push(registration);
      }
      await tx.ticket.update({ where: { id: ticketId }, data: { sold: { increment: requestedQuantity } } });
      return { registrations, total: totalAmount, transactionId: finTx.id };
    });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error("Erro no PDV Sell", err);
    return res.status(400).json({ message: err.message || "Erro na venda física." });
  }
});

export default router;
