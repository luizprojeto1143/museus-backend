import "dotenv/config";
import { prisma } from "./prisma.js";
import express from "express";
import publicCitiesRoutes from "./routes/public/cities.js";
import publicProvidersRoutes from "./routes/public/providers.js";
import { Socket } from "net";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import path from "path";
import swaggerUi from 'swagger-ui-express';
import { specs } from './config/swagger.js';

import authRoutes from "./routes/auth.js";
import tenantRoutes from "./domains/governance/tenants.js";
import worksRoutes from "./domains/cultural/works.js";
import trailsRoutes from "./domains/cultural/trails.js";
import eventsRoutes from "./domains/cultural/events.js";
import visitorsRoutes from "./routes/visitors.js";
import { correlationIdMiddleware } from "./infrastructure/logger/correlationId.middleware.js";
import "./infrastructure/queue/workers/background.worker.js"; // Inicializa o worker do BullMQ
import uploadRoutes from "./routes/upload.js";
import inPersonServicesRoutes from "./domains/commerce/in-person-services.js";
import tenantServicesRoutes from "./domains/governance/tenant-services.js";
import aiRoutes from "./routes/ai.js";
import qrRoutes from "./routes/qr.js";
import qrcodesRoutes from "./routes/qrcodes.js";
import analyticsRoutes from "./domains/governance/analytics.js";
import personaRoutes from "./routes/persona.js";
import achievementsRoutes from "./domains/experience/achievements.js";
import stampsRoutes from "./domains/experience/stamps.js";
import usersRoutes from "./routes/users.js";
import categoriesRoutes from "./routes/categories.js";
import bookingsRoutes from "./domains/commerce/bookings.js";
import guestbookRoutes from "./routes/guestbook.js";
import leaderboardRoutes from "./domains/experience/leaderboard.js";
import searchRoutes from "./routes/search.js";
import cluesRoutes from "./domains/experience/clues.js";
import certificatesRoutes from "./domains/trust-safety/certificates.js";
import certificateTemplatesRoutes from "./domains/trust-safety/certificate-templates.js";
import certificateRulesRoutes from "./domains/trust-safety/certificate-rules.js";
import seederRoutes from "./routes/master/seeder.js";
import { ticketsRouter } from "./domains/commerce/tickets.js";
import { registrationsRouter } from "./routes/registrations.js";
import favoritesRoutes from "./routes/favorites.js";
import reviewsRoutes from "./domains/trust-safety/reviews.js";
import healthRoutes from "./routes/health.js";
import newsletterRoutes from "./routes/newsletter.js";
import donationsRoutes from "./domains/commerce/donations.js";
import auditRoutes from "./domains/governance/audit.js";
import shopRoutes from "./domains/commerce/shop.js";
import challengesRoutes from "./domains/experience/challenges.js";
import backupRoutes from "./routes/backup.js";
import floorPlansRoutes from "./domains/cultural/floorPlans.js";
import { financeRouter } from "./domains/commerce/finance.js";
import { couponsRouter } from "./domains/commerce/coupons.js";
import skinsRoutes from "./domains/experience/skins.js";
import marketplaceRoutes from "./domains/commerce/marketplace.js";
import badgeRoutes from "./domains/experience/badgeRoutes.js";
import { roteiroRoutes } from "./domains/cultural/roteiro.routes.js";
import providerRoutes from "./domains/commerce/provider.routes.js";
import masterEcosystemRoutes from "./domains/governance/master-ecosystem.routes.js";

import navigationRoutes from "./routes/navigation.js";
import publicPassportRoutes from "./routes/public/passport.js";
import accessibilityRoutes from "./routes/accessibility.js";
import surveysRoutes from "./routes/surveys.js";
import notificationsRoutes from "./routes/notifications.js";
import contactRoutes from "./routes/contact.js";

// Municipal/Public Management Routes
import noticesRoutes from "./routes/notices.js";
import projectsRoutes from "./routes/projects.js";
import accessibilityExecutionRoutes from "./routes/accessibility-execution.js";
import providersRoutes from "./routes/providers.js";
import equipamentalRoutes from "./domains/cultural/equipamentos.js";

// Governance Routes
import plansRoutes from "./domains/governance/plans.js";
import executiveReportsRoutes from "./domains/governance/executive-reports.js";
import secretaryRoutes from "./domains/governance/secretary.js";
import aiCostsRoutes from "./routes/ai-costs.js";
import institutionalExportRoutes from "./routes/institutional-export.js";
import inboxRoutes from "./routes/inbox.js";
import curatorNotesRoutes from "./domains/cultural/curator-notes.js";
import npsRoutes from "./routes/nps.js";
import sentimentRoutes from "./routes/sentiment.js";
import teachersRoutes from "./routes/teachers.js";
import ticketTransfersRoutes from "./domains/commerce/ticket-transfers.js";
import membershipsRoutes from "./routes/memberships.js";
import volunteersRoutes from "./routes/volunteers.js";
import conservationRoutes from "./domains/cultural/conservation.js";
import ppaRoutes from "./domains/governance/ppa.js";
import collectiblesRoutes from "./domains/experience/collectibles.js";
import translationsRoutes from "./routes/translations.js";
import museumBattleRoutes from "./domains/experience/museum-battle.js";
import moderationRoutes from "./domains/trust-safety/moderation.js";
import heritageRoutes from "./domains/cultural/heritage.js";
import socialCheckinRoutes from "./domains/experience/social-checkin.js";
import groupTicketsRoutes from "./domains/commerce/group-tickets.js";
import rpgRoutes from "./domains/experience/rpg.js";
import communityRoutes from "./routes/community.js";
import quizRoutes from "./routes/quiz.js";
import extraRoutes from "./domains/governance/roadmap-extra.js";
import familyRoutes from "./domains/governance/roadmap-family.js";
import charactersRoutes from "./routes/characters.js";
import vestigesRoutes from "./domains/cultural/vestiges.js";
import vestigeAlertsRoutes from "./domains/cultural/vestige-alerts.js";
import webhooksRoutes from "./routes/webhooks.js";
import { stripeRouter } from "./domains/commerce/stripe.js";
import theaterRoutes from "./routes/theater.js";
import { validateEnv } from "./config/validateEnv.js";
import { limiter } from "./middleware/rateLimiter.js";
import { tenantMiddleware } from "./middleware/tenant.js";

// Validate critical environment variables on boot
validateEnv();

const app = express();
app.set('trust proxy', 1);

const corsOrigin = (() => {
  if (process.env.NODE_ENV === "production") {
    if (!process.env.FRONTEND_URL) {
      // C2: Never fall back to '*' in production — fail fast so the problem is visible immediately.
      console.error("❌ FATAL: FRONTEND_URL is required in production. Set this environment variable and redeploy.");
      process.exit(1);
    }
    const baseUrls = process.env.FRONTEND_URL.split(',').map(u => u.trim().replace(/\/$/, ''));
    // Return both with and without trailing slash to be safe
    const allUrls = [...baseUrls, ...baseUrls.map(u => `${u}/`)];
    return allUrls.length === 1 ? allUrls[0] : allUrls;
  }
  return "*";
})();

app.use(cors({
  origin: corsOrigin,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Tenant-ID", "X-Requested-With", "Accept"],
  credentials: true
}));

// Handle preflight requests explicitly
app.options("*", cors());

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // C6: Removed 'unsafe-inline' — scripts must be loaded from trusted origins only.
      // If inline scripts are needed in the future, use per-request nonces instead.
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "https:", "http:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "https:", "http:"],
      frameSrc: ["'none'"]
    }
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));

app.use(compression());

// C9: Apply global rate limiter to ALL routes (500 req/15min per IP).
// Specific routes (auth, AI, upload) have their own tighter limiters applied locally.
app.use(limiter);

app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: "2mb" })); // Reduced from 10mb for general security. Upload routes have their own multer limit.
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// --- Observability (Logging Estruturado e Rastreio) ---
app.use(correlationIdMiddleware);

app.use(tenantMiddleware);

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[REQ] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms | Origin: ${req.headers.origin || 'none'}`);
  });
  next();
});

// C1: CSRF Protection Middleware
// Require 'X-Requested-With: XMLHttpRequest' for mutating requests when auth is present
app.use((req, res, next) => {
  const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
  if (mutatingMethods.includes(req.method)) {
    // We allow stripe webhooks to bypass CSRF because they authenticate via webhook signatures
    if (req.path.startsWith('/stripe/webhook') || req.path.startsWith('/webhooks')) {
      return next();
    }
    const requestedWith = req.headers['x-requested-with'];
    if (requestedWith !== 'XMLHttpRequest') {
      return res.status(403).json({ message: "CSRF token missing or incorrect." });
    }
  }
  next();
});

app.get("/", (_req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV || "dev", v: "1.4.3" });
});

import sponsorPortalRoutes from "./routes/sponsor-portal.js";
app.use("/sponsor-portal", sponsorPortalRoutes);
app.use("/auth", authRoutes);
app.use("/tenants", tenantRoutes);
app.use("/works", worksRoutes);
app.use("/trails", trailsRoutes);
app.use("/events", eventsRoutes);
app.use("/visitors", visitorsRoutes);
app.use("/upload", uploadRoutes);
app.use("/public/cities", publicCitiesRoutes);
app.use("/public/providers", publicProvidersRoutes);
app.use("/in-person-services", inPersonServicesRoutes);
app.use("/tenant-services", tenantServicesRoutes);
app.use("/ai", aiRoutes);
app.use("/qr", qrRoutes);
app.use("/qrcodes", qrcodesRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/persona", personaRoutes);
app.use("/achievements", achievementsRoutes);
app.use("/stamps", stampsRoutes);
app.use("/users", usersRoutes);
app.use("/categories", categoriesRoutes);
app.use("/bookings", bookingsRoutes);
app.use("/guestbook", guestbookRoutes);
app.use("/leaderboard", leaderboardRoutes);
app.use("/finance", financeRouter);
app.use("/coupons", couponsRouter);
import gamificationRoutes from "./domains/experience/gamification.js";

app.use("/gamification", gamificationRoutes);
app.use("/search", searchRoutes);
app.use("/clues", cluesRoutes);
app.use("/certificates", certificatesRoutes);
app.use("/certificate-templates", certificateTemplatesRoutes);
app.use("/certificate-rules", certificateRulesRoutes);
app.use("/tickets", ticketsRouter);
app.use("/registrations", registrationsRouter);
app.use("/favorites", favoritesRoutes);
app.use("/reviews", reviewsRoutes);
app.use("/health", healthRoutes);
app.use("/newsletter", newsletterRoutes);
app.use("/donations", donationsRoutes);
app.use("/audit-logs", auditRoutes);
app.use("/shop", shopRoutes);
app.use("/challenges", challengesRoutes);
app.use("/skins", skinsRoutes);
app.use("/marketplace", marketplaceRoutes);
app.use("/badges", badgeRoutes);
app.use("/backup", backupRoutes);
app.use("/floor-plans", floorPlansRoutes);
app.use("/roteiro", roteiroRoutes);
app.use("/:tenantSlug/provider", providerRoutes);
app.use("/:tenantSlug/master-ecosystem", masterEcosystemRoutes);

app.use("/navigation", navigationRoutes);
app.use("/accessibility", accessibilityRoutes);
app.use("/public-passport", publicPassportRoutes);
app.use(surveysRoutes); // Uses /events/:eventId/survey pattern
import publicCertificateRoutes from "./routes/public/certificates.js";

app.use("/public/certificates", publicCertificateRoutes);

import opsRoutes from "./domains/governance/ops.js";
app.use("/ops", opsRoutes);
app.use("/notifications", notificationsRoutes);
app.use("/contact", contactRoutes);

// Municipal/Public Management Routes
app.use("/notices", noticesRoutes);
app.use("/projects", projectsRoutes);
app.use("/accessibility-execution", accessibilityExecutionRoutes);
app.use("/providers", providersRoutes);
app.use("/equipamentos", equipamentalRoutes);

import spacesRoutes from "./domains/cultural/spaces.js";
app.use("/spaces", spacesRoutes);

import reportsRoutes from "./domains/governance/reports.js";
app.use("/reports", reportsRoutes);

// Governance Routes
app.use("/plans", plansRoutes);
app.use("/executive-reports", executiveReportsRoutes);
app.use("/secretary", secretaryRoutes);
app.use("/ai-costs", aiCostsRoutes);
app.use("/institutional-export", institutionalExportRoutes);
app.use("/inbox", inboxRoutes);
app.use("/seeder", seederRoutes);

// Phase 1 — Analytics & UX
app.use("/curator-notes", curatorNotesRoutes);
app.use("/nps", npsRoutes);
app.use("/sentiment", sentimentRoutes);

// Phase 2-5 Routes
app.use("/teachers", teachersRoutes);
app.use("/ticket-transfers", ticketTransfersRoutes);
app.use("/memberships", membershipsRoutes);
app.use("/volunteers", volunteersRoutes);
app.use("/conservation", conservationRoutes);
app.use("/ppa", ppaRoutes);

// Phase 5 Routes
app.use("/collectibles", collectiblesRoutes);
app.use("/translations", translationsRoutes);
app.use("/museum-battle", museumBattleRoutes);
app.use("/moderation", moderationRoutes);

// Final Batch Routes
app.use("/heritage", heritageRoutes);
app.use("/social-checkin", socialCheckinRoutes);
app.use("/group-tickets", groupTicketsRoutes);
app.use("/rpg", rpgRoutes);
app.use("/community", communityRoutes);
app.use("/quiz", quizRoutes);
app.use("/roadmap-extra", extraRoutes);
app.use("/roadmap-family", familyRoutes);
app.use("/characters", charactersRoutes);
app.use("/vestiges", vestigesRoutes);
app.use("/vestige-alerts", vestigeAlertsRoutes);
app.use("/webhooks", webhooksRoutes);
app.use("/stripe", stripeRouter);
app.use("/theater", theaterRoutes);

const PORT = process.env.PORT || 3000;

// Global Error Handler
 
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const isProd = process.env.NODE_ENV === "production";

  // Always log full detail server-side
  const sanitizedBody = { ..._req.body };
  if (sanitizedBody.password) sanitizedBody.password = "****";
  if (sanitizedBody.cpf) sanitizedBody.cpf = "***.***.***-**";
  if (sanitizedBody.phone) sanitizedBody.phone = "****-****";

  const sanitizedHeaders = { ..._req.headers };
  if (sanitizedHeaders.authorization) sanitizedHeaders.authorization = "Bearer ****";
  if (sanitizedHeaders.cookie) sanitizedHeaders.cookie = "****";

  console.error("❌ Global Error Detail:", {
    message: err.message,
    stack: err.stack,
    name: err.name,
    code: err.code,
    path: _req.path,
    method: _req.method,
    body: sanitizedBody,
    headers: sanitizedHeaders
  });
  
  // Persist error to AuditLog for remote debugging
  // C3: Never fall back to a hardcoded tenant ID — null is always preferable to wrong data.
  const resolvedTenantId = _req.params.tenantId
    || String(_req.query.tenantId ?? "")
    || (_req as any).tenantId
    || null;

  prisma.auditLog.create({
    data: {
      action: "SERVER_ERROR",
      entity: "SYSTEM",
      entityId: _req.path,
      userId: (err as any).userId || null,
      userEmail: sanitizedBody.email || null,
      tenantId: resolvedTenantId,
      oldData: { path: _req.path, method: _req.method },
      newData: { 
        message: err.message, 
        stack: err.stack?.substring(0, 1000), 
        code: err.code,
        body: sanitizedBody
      },
      ipAddress: String(_req.headers['x-forwarded-for'] || _req.socket.remoteAddress || ""),
      userAgent: _req.headers['user-agent']
    }
  }).catch((e: any) => console.error("Failed to log error to DB:", e));
  
  // Never expose internals to client in production
  res.status(500).json({
    error: "Internal Server Error",
    message: isProd ? "Ocorreu um erro interno. Tente novamente." : err.message,
    ...(isProd ? {} : { code: err.code, path: _req.path }),
    timestamp: new Date().toISOString()
  });
});

export { app };

if (process.env.NODE_ENV !== 'test') {
  const start = async () => {
    try {
      console.log("⏳ Connecting to database...");
      await prisma.$connect();
      console.log("🔌 Connected to database successfully.");
    } catch (e) {
      console.error("❌ Failed to connect to database on startup:", e);
      console.warn("⚠️ Server will CONTINUE to start, but database requests may fail.");
    }

    const server = app.listen(PORT, () => {
      console.log(`✅ Museus backend enterprise running on port ${PORT}`);
      console.log(`🔧 Environment: ${process.env.NODE_ENV || "dev"}`);
      console.log(`🌐 Allowed Origin: ${process.env.NODE_ENV === "production" ? process.env.FRONTEND_URL : "*"}`);
      console.log(`📝 Audit logging is ${process.env.NODE_ENV === "production" ? "ACTIVE" : "ACTIVE (dev)"}`);
    });

    try {
      const { initCronJobs } = await import("./services/cron.js");
      initCronJobs();
    } catch (e) {
      console.error("Failed to initialize cron jobs:", e);
    }

    // C11: Graceful shutdown — drain active connections before exiting.
    // Render (and most PaaS) sends SIGTERM before killing the process.
    const connections = new Set<Socket>();
    server.on('connection', (socket: Socket) => {
      connections.add(socket);
      socket.on('close', () => connections.delete(socket));
    });

    const shutdown = async (signal: string) => {
      console.log(`\n[${signal}] Graceful shutdown initiated…`);
      server.close(async () => {
        console.log('🔒 HTTP server closed. Disconnecting database…');
        await prisma.$disconnect();
        console.log('✅ Graceful shutdown complete.');
        process.exit(0);
      });

      // Force-close any lingering keep-alive connections
      for (const socket of connections) socket.destroy();

      // Hard kill after 10s if something blocks
      setTimeout(() => {
        console.error('⏱️ Shutdown timed out — forcing exit.');
        process.exit(1);
      }, 10_000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
  };
  
  start();
}
