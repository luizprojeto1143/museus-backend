import { Router } from "express";
import fs from "fs";
import path from "path";
import { prisma } from "../../prisma.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();
import { Socket } from "net";

// Protect all /ops routes - MASTER ONLY
router.use(authMiddleware, requireRole([Role.MASTER]));

router.get("/test-dashboard", async (req, res) => {
  // C3: tenantId must be supplied explicitly — no hardcoded fallback.
  const tenantId = req.query.tenantId as string | undefined;
  if (!tenantId) return res.status(400).json({ error: "tenantId query param is required" });

  try {
    const results = await Promise.all([
      prisma.visitorVisit.count({ where: { visitor: { tenantId } } }),
      prisma.work.count({ where: { tenantId } })
    ]);
    await prisma.auditLog.create({
      data: {
        action: 'CUSTOM',
        entityType: 'SYSTEM',
        entityId: 'test-dashboard',
        tenantId,
        metadata: { timestamp: new Date().toISOString(), v: '1.3.0', originalAction: 'DIAGNOSTIC_TEST' }
      }
    });

    res.json({ success: true, count1: results[0], count2: results[1], logged: true });
  } catch (e: any) {
    res.status(500).json({ 
      success: false, 
      message: e.message, 
      stack: e.stack,
      url: (process.env.DATABASE_URL || "").replace(/:[^:@]+@/, ":****@")
    });
  }
});

router.get("/error-logs", async (req, res) => {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json(logs);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/debug-env", (req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ message: "Not found" });
    }
    // Get the origin from the app's closure if possible, or just re-calculate
    res.json({
      node_env: process.env.NODE_ENV,
      has_db_url: !!process.env.DATABASE_URL,
      db_url: (process.env.DATABASE_URL || "").replace(/:[^:@]+@/, ":****@"),
      has_jwt_secret: !!process.env.JWT_SECRET,
      timestamp: new Date().toISOString(),
      v: "1.3.0"
    });
  });


export default router;
