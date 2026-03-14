import { Router } from "express";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();
import { Socket } from "net";

router.get("/test-dashboard", async (req, res) => {
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
      url: (process.env.DATABASE_URL || "").replace(/:[^:@]+@/, ":****@")
    });
  }
});

router.get("/error-logs", async (req, res) => {
  try {
    const logs = await prisma.auditLog.findMany({
      where: { action: "SERVER_ERROR" },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json(logs);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/debug-env", (req, res) => {
    res.json({
      node_env: process.env.NODE_ENV,
      has_db_url: !!process.env.DATABASE_URL,
      has_jwt_secret: !!process.env.JWT_SECRET,
      timestamp: new Date().toISOString(),
      v: "1.2.5"
    });
  });

// Endpoint mágico para rodar migrações em produção
// Protegido por MASTER role para evitar abuso, mas pode ser aberto temporariamente se necessário
// Para facilitar para o usuário agora, vou deixar protegido apenas por um token simples no header ou query string
// chamaremos de ?secret=museus_admin_deploy_2024

router.get("/migrate", async (req, res) => {
    const { secret } = req.query;

    if (secret !== "museus_admin_deploy_2024") {
        return res.status(403).json({ message: "Forbidden" });
    }

    console.log("Starting migration via endpoint...");

    exec("npx prisma migrate deploy", (error, stdout, stderr) => {
        if (error) {
            console.error(`Migration error: ${error.message}`);
            return res.status(500).json({
                message: "Migration failed",
                error: error.message,
                stderr
            });
        }
        if (stderr) {
            console.warn(`Migration stderr: ${stderr}`);
        }

        console.log(`Migration stdout: ${stdout}`);
        return res.json({
            message: "Migration executed successfully",
            stdout
        });
    });
});

router.get("/db-sync-check", async (req, res) => {
    try {
        // Test critical tables and columns
        const checks = {
            tenant_deletedAt: false,
            work_deletedAt: false,
            event_deletedAt: false,
            accessibility_provider: false
        };

        try {
            await (prisma.tenant as any).findFirst({ select: { id: true, deletedAt: true } as any, take: 1 });
            checks.tenant_deletedAt = true;
        } catch (e) {
            console.error("Check failed: Tenant.deletedAt", e);
        }

        try {
            await (prisma.work as any).findFirst({ select: { id: true, deletedAt: true } as any, take: 1 });
            checks.work_deletedAt = true;
        } catch (e) {
            console.error("Check failed: Work.deletedAt", e);
        }

        try {
            await (prisma.event as any).findFirst({ select: { id: true, deletedAt: true } as any, take: 1 });
            checks.event_deletedAt = true;
        } catch (e) {
            console.error("Check failed: Event.deletedAt", e);
        }

        try {
            await (prisma as any).accessibilityProvider.count();
            checks.accessibility_provider = true;
        } catch (e) {
            console.error("Check failed: AccessibilityProvider", e);
        }

        const isFullySynced = Object.values(checks).every(v => v === true);

        return res.json({
            status: isFullySynced ? "fully_synced" : "partially_synced",
            timestamp: new Date().toISOString(),
            checks
        });
    } catch (err) {
        return res.status(500).json({ error: "Sync check failed", details: String(err) });
    }
});

router.get("/apply-recovery-v3", async (req, res) => {
    const { secret } = req.query;
    if (secret !== "museus_admin_deploy_2024") {
        return res.status(403).json({ message: "Forbidden" });
    }

    const maxRetries = 3;
    let lastError = null;

    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`Manual migration attempt ${i + 1}/${maxRetries}...`);
            const sqlPath = path.join(process.cwd(), "prisma/migrations/20260312093000_massive_recovery_v3/migration.sql");
            
            if (!fs.existsSync(sqlPath)) {
                return res.status(404).json({ error: "Migration file not found", path: sqlPath });
            }

            const sql = fs.readFileSync(sqlPath, "utf8");

            // Split by semicolon but respect DO $$ blocks
            const statements: string[] = [];
            let currentStatement = "";
            let inDollarBlock = false;

            const lines = sql.split("\n");
            for (const line of lines) {
                currentStatement += line + "\n";
                
                // Toggle dollar block state if line contains $$
                if (line.includes("$$")) {
                    inDollarBlock = !inDollarBlock;
                }

                // If we're not inside a dollar block and the line ends with a semicolon
                if (!inDollarBlock && line.trim().endsWith(";")) {
                    const stmt = currentStatement.trim();
                    if (stmt) statements.push(stmt);
                    currentStatement = "";
                }
            }
            // Add any remaining content
            if (currentStatement.trim()) statements.push(currentStatement.trim());

            console.log(`Executing ${statements.length} SQL blocks...`);
            
            for (const statement of statements) {
                await prisma.$executeRawUnsafe(statement);
            }

            return res.json({ 
                message: "Recovery V3 applied successfully with block awareness",
                attempts: i + 1,
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            lastError = err;
            console.error(`Attempt ${i + 1} failed:`, err);
            // Wait 2s before retry
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    return res.status(500).json({ 
        error: "Failed to apply SQL after retries", 
        details: lastError instanceof Error ? lastError.message : String(lastError) 
    });
});

export default router;
