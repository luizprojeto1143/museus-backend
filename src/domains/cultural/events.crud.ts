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

export function registerEventCrud(router: Router) {
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
      // Sympla Killer Features
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

    await validateEventRelations(tenantId, { categoryId, equipamentoId });

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

    // IDOR Protection: Verify resource belongs to user's tenant
    const existingEvent = await assertTenantOwnership({ model: 'event', id, user });
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

    await validateEventRelations(existingEvent.tenantId, { categoryId, equipamentoId });

    // Validate Space and Conflicts if changed
    if (spaceId) {
      const space = await prisma.space.findUnique({ where: { id: spaceId } });
      if (!space || space.tenantId !== existingEvent.tenantId) return res.status(404).json({ message: "Espaco nao encontrado" });

      const conflictStart = startDate ? new Date(startDate) : existingEvent.startDate;
      const conflictEnd = endDate ? new Date(endDate) : (existingEvent.endDate || conflictStart);

      const conflicts = await prisma.booking.count({
        where: {
          eventId: { not: id },
          spaceId,
          status: { not: "CANCELLED" },
          AND: [
            { startTime: { lt: conflictEnd } },
            { endTime: { gt: conflictStart } }
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

    // IDOR Protection: Verify resource belongs to user's tenant
    const existing = await assertTenantOwnership({ model: 'event', id, user });

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
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("Erro excluir evento", err);
    return res.status(500).json({ message: "Erro ao excluir evento" });
  }
});

// Check check-in status

}
