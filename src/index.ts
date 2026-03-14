import "dotenv/config";
import { prisma } from "./prisma.js";
import express from "express";
import { Socket } from "net";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import swaggerUi from 'swagger-ui-express';
import { specs } from './config/swagger.js';

import authRoutes from "./routes/auth.js";
import tenantRoutes from "./routes/tenants.js";
import worksRoutes from "./routes/works.js";
import trailsRoutes from "./routes/trails.js";
import eventsRoutes from "./routes/events.js";
import visitorsRoutes from "./routes/visitors.js";
import uploadRoutes from "./routes/upload.js";
import inPersonServicesRoutes from "./routes/in-person-services.js";
import tenantServicesRoutes from "./routes/tenant-services.js";
import aiRoutes from "./routes/ai.js";
import qrRoutes from "./routes/qr.js";
import qrcodesRoutes from "./routes/qrcodes.js";
import analyticsRoutes from "./routes/analytics.js";
import personaRoutes from "./routes/persona.js";
import achievementsRoutes from "./routes/achievements.js";
import stampsRoutes from "./routes/stamps.js";
import usersRoutes from "./routes/users.js";
import categoriesRoutes from "./routes/categories.js";
import bookingsRoutes from "./routes/bookings.js";
import guestbookRoutes from "./routes/guestbook.js";
import leaderboardRoutes from "./routes/leaderboard.js";
import searchRoutes from "./routes/search.js";
import cluesRoutes from "./routes/clues.js";
import certificatesRoutes from "./routes/certificates.js";
import certificateTemplatesRoutes from "./routes/certificate-templates.js";
import certificateRulesRoutes from "./routes/certificate-rules.js";
import seederRoutes from "./routes/master/seeder.js";
import { ticketsRouter } from "./routes/tickets.js";
import { registrationsRouter } from "./routes/registrations.js";
import favoritesRoutes from "./routes/favorites.js";
import reviewsRoutes from "./routes/reviews.js";
import healthRoutes from "./routes/health.js";
import newsletterRoutes from "./routes/newsletter.js";
import donationsRoutes from "./routes/donations.js";
import auditRoutes from "./routes/audit.js";
import shopRoutes from "./routes/shop.js";
import challengesRoutes from "./routes/challenges.js";
import backupRoutes from "./routes/backup.js";
import floorPlansRoutes from "./routes/floorPlans.js";
import { financeRouter } from "./routes/finance.js";
import { couponsRouter } from "./routes/coupons.js";
import skinsRoutes from "./routes/skins.js";
import marketplaceRoutes from "./routes/marketplace.js";
import badgeRoutes from "./routes/badgeRoutes.js";

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
import equipamentalRoutes from "./routes/equipamentos.js";

// Governance Routes
import plansRoutes from "./routes/plans.js";
import executiveReportsRoutes from "./routes/executive-reports.js";
import secretaryRoutes from "./routes/secretary.js";
import aiCostsRoutes from "./routes/ai-costs.js";
import institutionalExportRoutes from "./routes/institutional-export.js";
import inboxRoutes from "./routes/inbox.js";
import curatorNotesRoutes from "./routes/curator-notes.js";
import npsRoutes from "./routes/nps.js";
import sentimentRoutes from "./routes/sentiment.js";
import teachersRoutes from "./routes/teachers.js";
import ticketTransfersRoutes from "./routes/ticket-transfers.js";
import membershipsRoutes from "./routes/memberships.js";
import volunteersRoutes from "./routes/volunteers.js";
import conservationRoutes from "./routes/conservation.js";
import ppaRoutes from "./routes/ppa.js";
import collectiblesRoutes from "./routes/collectibles.js";
import translationsRoutes from "./routes/translations.js";
import museumBattleRoutes from "./routes/museum-battle.js";
import moderationRoutes from "./routes/moderation.js";
import heritageRoutes from "./routes/heritage.js";
import socialCheckinRoutes from "./routes/social-checkin.js";
import groupTicketsRoutes from "./routes/group-tickets.js";
import rpgRoutes from "./routes/rpg.js";
import communityRoutes from "./routes/community.js";
import quizRoutes from "./routes/quiz.js";
import extraRoutes from "./routes/roadmap-extra.js";
import familyRoutes from "./routes/roadmap-family.js";
import charactersRoutes from "./routes/characters.js";
import webhooksRoutes from "./routes/webhooks.js";
import { validateEnv } from "./config/validateEnv.js";

// Validate critical environment variables on boot
validateEnv();

const app = express();
app.set('trust proxy', 1);

const corsOrigin = (() => {
  if (process.env.NODE_ENV === "production") {
    if (!process.env.FRONTEND_URL) {
      console.warn("⚠️  WARNING: FRONTEND_URL is not set in production. Defaulting to '*' for demo purposes.");
      return "*";
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
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[REQ] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms | Origin: ${req.headers.origin || 'none'}`);
  });
  next();
});

// Public diagnostic routes (TEMPORARY FOR DEBUGGING)
app.get("/ops/debug-env", (req, res) => {
  res.json({
    node_env: process.env.NODE_ENV,
    cors_origin: corsOrigin,
    has_db_url: !!process.env.DATABASE_URL,
    has_jwt_secret: !!process.env.JWT_SECRET,
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

app.get("/ops/test-dashboard-queries", async (req, res) => {
  const tenantId = '8cc9b546-7f7d-4908-a6cf-acdd7b86982b';
  try {
    const [count1, count2] = await Promise.all([
      prisma.visitorVisit.count({ where: { visitor: { tenantId } } }),
      prisma.work.count({ where: { tenantId } })
    ]);
    res.json({ success: true, count1, count2 });
  } catch (e: any) {
    res.status(500).json({ 
      success: false, 
      message: e.message, 
      stack: e.stack,
      url: process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@")
    });
  }
});

app.get("/", (_req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV || "dev", v: "1.2.2" });
});

app.use("/auth", authRoutes);
app.use("/tenants", tenantRoutes);
app.use("/works", worksRoutes);
app.use("/trails", trailsRoutes);
app.use("/events", eventsRoutes);
app.use("/visitors", visitorsRoutes);
app.use("/upload", uploadRoutes);
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
import gamificationRoutes from "./routes/gamification.js";

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

app.use("/navigation", navigationRoutes);
app.use("/accessibility", accessibilityRoutes);
app.use("/public-passport", publicPassportRoutes);
app.use(surveysRoutes); // Uses /events/:eventId/survey pattern
import publicCertificateRoutes from "./routes/public/certificates.js";

app.use("/public/certificates", publicCertificateRoutes);

import opsRoutes from "./routes/ops.js";
app.use("/ops", opsRoutes);
app.use("/notifications", notificationsRoutes);
app.use("/contact", contactRoutes);

// Municipal/Public Management Routes
app.use("/notices", noticesRoutes);
app.use("/projects", projectsRoutes);
app.use("/accessibility-execution", accessibilityExecutionRoutes);
app.use("/providers", providersRoutes);
app.use("/equipamentos", equipamentalRoutes);

import spacesRoutes from "./routes/spaces.js";
app.use("/spaces", spacesRoutes);

import reportsRoutes from "./routes/reports.js";
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
app.use("/webhooks", webhooksRoutes);

const PORT = process.env.PORT || 3000;

// Global Error Handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const sanitizedBody = { ..._req.body };
  if (sanitizedBody.password) sanitizedBody.password = "****";

  console.error("❌ Global Error Detail:", {
    message: err.message,
    stack: err.stack,
    name: err.name,
    code: err.code,
    path: _req.path,
    method: _req.method,
    body: sanitizedBody,
    headers: _req.headers
  });
  
  // Persist error to AuditLog for remote debugging
  prisma.auditLog.create({
    data: {
      action: "SERVER_ERROR",
      entity: "SYSTEM",
      entityId: _req.path,
      userId: (err as any).userId || null,
      userEmail: sanitizedBody.email || null,
      tenantId: (_req as any).tenantId || "GLOBAL",
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
  
  res.status(500).json({
    error: "Internal Server Error",
    message: err.message,
    code: err.code,
    // Helping debug in prod temporarily
    path: _req.path,
    timestamp: new Date().toISOString()
  });
});

export { app };

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`✅ Museus backend enterprise running on port ${PORT}`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || "dev"}`);
    console.log(`🌐 Allowed Origin: ${process.env.NODE_ENV === "production" ? (process.env.FRONTEND_URL || "*") : "*"}`);
  });
}
