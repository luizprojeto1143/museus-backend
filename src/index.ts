import "dotenv/config";
import express from "express";
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

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

import { limiter } from "./middleware/rateLimiter.js";
app.use(limiter);

const uploadDir = process.env.UPLOAD_DIR || "uploads";
app.use("/uploads", express.static(path.join(process.cwd(), uploadDir)));

app.get("/", (_req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV || "dev" });
});

app.use("/auth", authRoutes);
app.use("/tenants", tenantRoutes);
app.use("/works", worksRoutes);
app.use("/trails", trailsRoutes);
app.use("/events", eventsRoutes);
app.use("/visitors", visitorsRoutes);
app.use("/upload", uploadRoutes);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Museus backend enterprise running on port ${PORT}`);
});
