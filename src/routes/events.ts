import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { sendCertificateEmail, generateCertificateBuffer } from "../services/email.js";

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

    const { title, description, location, startDate, endDate, categoryId } = req.body as EventBody;
    const event = await prisma.event.create({
      data: {
        title,
        description,
        location,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        categoryId: categoryId && categoryId !== "" ? categoryId : null,
        tenantId
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
    const { title, description, location, startDate, endDate } = req.body as {
      title: string;
      description?: string;
      location?: string;
      startDate: string;
      endDate?: string;
    };
    const event = await prisma.event.update({
      where: { id },
      data: {
        title,
        description,
        location,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null
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

// Check-in no evento
router.post("/:id/checkin", async (req, res) => {
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
    const existing = await prisma.eventAttendance.findFirst({
      where: { eventId: id, visitorId: targetVisitorId }
    });

    if (existing) {
      return res.json({ message: "Check-in já realizado", attendance: existing });
    }

    // Registrar check-in
    const attendance = await prisma.eventAttendance.create({
      data: {
        eventId: id,
        visitorId: targetVisitorId,
        status: "PRESENT",
        checkInTime: new Date()
      }
    });

    // Opcional: Registrar XP também se evento tiver recompensa (via VisitorVisit separada ou aqui)
    // Vamos registrar uma VisitorVisit para constar no histórico geral e ganhar XP se não tiver ganho ainda
    // Mas normalmente isso é feito via QR Code separado ou automático. 
    // Vou adicionar VisitorVisit para garantir consistência com o histórico
    await prisma.visitorVisit.create({
      data: {
        visitorId: targetVisitorId,
        eventId: id,
        source: "CHECKIN",
        xpGained: 10 // Valor fixo ou buscar do evento se tiver campo XP
      }
    });

    await prisma.visitor.update({
      where: { id: targetVisitorId },
      data: { xp: { increment: 10 } }
    });

    return res.status(201).json({ message: "Check-in realizado com sucesso", attendance });
  } catch (err) {
    console.error("Erro check-in", err);
    return res.status(500).json({ message: "Erro ao realizar check-in" });
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
router.post("/:id/certificate", async (req, res) => {
  try {
    const { id } = req.params;
    const { visitorId } = req.body;

    if (!visitorId) {
      return res.status(400).json({ message: "visitorId é obrigatório" });
    }

    const event = await prisma.event.findUnique({
      where: { id },
      include: { tenant: true }
    });

    if (!event) {
      return res.status(404).json({ message: "Evento não encontrado" });
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

export default router;
