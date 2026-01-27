import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { sendCertificateEmail, generateCertificateBuffer } from "../services/email.js";
import { z } from "zod";

const router = Router();

// Lista eventos
router.get("/", async (req, res) => {
  try {
    const tenantId = req.query.tenantId as string | undefined;
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório" });
    }
    const events = await prisma.event.findMany({
      where: { tenantId },
      orderBy: { startDate: "asc" }
    });
    return res.json(events);
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

// CRUD Admin
router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
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
      customFormSchema, galleryUrls
    } = req.body;

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

        tenant: { connect: { id: tenantId } }
      }
    });

    return res.status(201).json(event);
  } catch (err) {
    console.error("Erro criar evento", err);
    return res.status(500).json({ message: "Erro ao criar evento" });
  }
});

router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
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
      customFormSchema, galleryUrls
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

        coverImageUrl,
        // Sympla Killer Features
        customFormSchema,
        galleryUrls: galleryUrls ? JSON.stringify(galleryUrls) : undefined
      }
    });

    return res.json(event);
  } catch (err) {
    console.error("Erro atualizar evento", err);
    return res.status(500).json({ message: "Erro ao atualizar evento" });
  }
});

router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
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
    const { visitorId, email } = req.body;

    if (!visitorId && !email) {
      return res.status(400).json({ message: "É necessário informar visitorId ou email" });
    }

    const event = await prisma.event.findUnique({
      where: { id },
      include: { tenant: true }
    });

    if (!event) {
      return res.status(404).json({ message: "Evento não encontrado" });
    }

    let targetVisitorId = visitorId;

    // Se forneceu email, buscar visitante
    if (email) {
      const visitor = await prisma.visitor.findFirst({
        where: { email, tenantId: event.tenantId }
      });
      if (!visitor) {
        return res.status(404).json({ message: "Visitante não encontrado neste museu" });
      }
      targetVisitorId = visitor.id;
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
      if (err instanceof Error && 'code' in err && (err as any).code === 'P2002') {
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

export default router;
