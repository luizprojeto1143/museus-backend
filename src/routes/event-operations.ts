import { Router } from "express";
import crypto from "crypto";
import QRCode from "qrcode";
import { prisma } from "../prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { sendOk } from "../utils/apiResponse.js";

const router = Router();

function hashToNumber(input: string, max: number) {
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  return (parseInt(hash.slice(0, 8), 16) % max) + 1;
}

async function getCapacity(eventId: string) {
  const tickets = await prisma.ticket.findMany({
    where: { eventId },
    include: {
      _count: {
        select: {
          registrations: true
        }
      },
      registrations: {
        where: {
          status: { in: ["CONFIRMED", "PENDING"] }
        },
        select: { id: true, status: true, checkInDate: true }
      }
    },
    orderBy: { price: "asc" }
  });

  const totals = tickets.reduce((acc, ticket) => {
    const confirmed = ticket.registrations.filter(reg => reg.status === "CONFIRMED").length;
    const pending = ticket.registrations.filter(reg => reg.status === "PENDING").length;
    const checkedIn = ticket.registrations.filter(reg => !!reg.checkInDate).length;
    acc.capacity += ticket.quantity;
    acc.confirmed += confirmed;
    acc.pending += pending;
    acc.checkedIn += checkedIn;
    return acc;
  }, { capacity: 0, confirmed: 0, pending: 0, checkedIn: 0 });

  const reserved = totals.confirmed + totals.pending;
  const available = Math.max(0, totals.capacity - reserved);
  const occupancyRate = totals.capacity > 0 ? Math.round((reserved / totals.capacity) * 100) : 0;

  return {
    capacity: totals.capacity,
    confirmed: totals.confirmed,
    pending: totals.pending,
    checkedIn: totals.checkedIn,
    reserved,
    available,
    occupancyRate,
    soldOut: available === 0 && totals.capacity > 0,
    tickets: tickets.map(ticket => {
      const confirmed = ticket.registrations.filter(reg => reg.status === "CONFIRMED").length;
      const pending = ticket.registrations.filter(reg => reg.status === "PENDING").length;
      const reservedForTicket = confirmed + pending;
      return {
        id: ticket.id,
        name: ticket.name,
        type: ticket.type,
        status: ticket.status,
        price: Number(ticket.price),
        quantity: ticket.quantity,
        confirmed,
        pending,
        reserved: reservedForTicket,
        available: Math.max(0, ticket.quantity - reservedForTicket)
      };
    })
  };
}

router.get("/events/:eventId/capacity", async (req, res) => {
  const event = await prisma.event.findUnique({
    where: { id: req.params.eventId },
    select: { id: true, title: true, startDate: true, endDate: true, status: true, visibility: true }
  });

  if (!event || event.visibility !== "PUBLIC") {
    return res.status(404).json({ message: "Evento nao encontrado" });
  }

  const capacity = await getCapacity(event.id);
  return sendOk(res, { event, capacity }, { generatedAt: new Date().toISOString() });
});

router.post("/events/:eventId/queue/join", async (req, res) => {
  const { email, name } = req.body || {};
  if (!email || typeof email !== "string") {
    return res.status(400).json({ message: "email e obrigatorio" });
  }

  const event = await prisma.event.findUnique({
    where: { id: req.params.eventId },
    select: { id: true, title: true, startDate: true, visibility: true }
  });

  if (!event || event.visibility !== "PUBLIC") {
    return res.status(404).json({ message: "Evento nao encontrado" });
  }

  const capacity = await getCapacity(event.id);
  const pressure = Math.max(1, capacity.pending + Math.max(0, capacity.reserved - capacity.capacity) + 1);
  const position = capacity.soldOut
    ? hashToNumber(`${event.id}:${email.toLowerCase()}`, Math.max(pressure, 25))
    : 0;
  const estimatedWaitMinutes = position === 0 ? 0 : Math.ceil(position * 2.5);
  const queueToken = crypto
    .createHmac("sha256", process.env.JWT_SECRET || "dev-queue-secret")
    .update(`${event.id}:${email.toLowerCase()}`)
    .digest("hex");

  return sendOk(res, {
    event,
    participant: { email: email.toLowerCase(), name: name || null },
    queue: {
      active: capacity.soldOut,
      position,
      estimatedWaitMinutes,
      token: queueToken
    },
    capacity
  });
});

router.get("/registrations/:code/wallet", authMiddleware, async (req, res) => {
  const registration = await prisma.registration.findUnique({
    where: { code: req.params.code },
    include: {
      ticket: true,
      event: {
        include: {
          tenant: { select: { name: true, logoUrl: true, primaryColor: true } },
          equipamentoCultural: { select: { nome: true, endereco: true, cidade: true, estado: true } }
        }
      }
    }
  });

  if (!registration) {
    return res.status(404).json({ message: "Ingresso nao encontrado" });
  }

  const user = req.user!;
  if (user.role !== "MASTER" && user.tenantId && registration.event.tenantId !== user.tenantId && user.email.toLowerCase() !== registration.guestEmail.toLowerCase()) {
    return res.status(403).json({ message: "Sem permissao para acessar este ingresso" });
  }

  if (!["CONFIRMED", "PAID"].includes(registration.status)) {
    return res.status(400).json({ message: "Ingresso ainda nao confirmado" });
  }

  const verifyUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/tickets/verify/${registration.code}`;
  const qrCodeDataUrl = await QRCode.toDataURL(registration.code);

  return sendOk(res, {
    format: "GENERIC_WALLET_PASS",
    code: registration.code,
    qrCodeDataUrl,
    verifyUrl,
    holder: {
      name: registration.guestName,
      email: registration.guestEmail
    },
    event: {
      id: registration.event.id,
      title: registration.event.title,
      startDate: registration.event.startDate,
      endDate: registration.event.endDate,
      location: registration.event.location || registration.event.equipamentoCultural?.nome || null,
      city: registration.event.city || registration.event.equipamentoCultural?.cidade || null,
      state: registration.event.state || registration.event.equipamentoCultural?.estado || null
    },
    ticket: {
      id: registration.ticket.id,
      name: registration.ticket.name,
      type: registration.ticket.type
    },
    organization: {
      name: registration.event.tenant.name,
      logoUrl: registration.event.tenant.logoUrl,
      primaryColor: registration.event.tenant.primaryColor
    },
    wallet: {
      applePassReady: false,
      googleWalletReady: false,
      note: "Payload pronto para renderizacao no app. Arquivos Apple/Google exigem certificados/chaves do emissor no ambiente de producao."
    }
  });
});

export default router;
