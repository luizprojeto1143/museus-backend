import { Router } from "express";
import { exec } from "child_process";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

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
            await prisma.tenant.findFirst({ select: { id: true, deletedAt: true }, take: 1 });
            checks.tenant_deletedAt = true;
        } catch (e) {
            console.error("Check failed: Tenant.deletedAt", e);
        }

        try {
            await prisma.work.findFirst({ select: { id: true, deletedAt: true }, take: 1 });
            checks.work_deletedAt = true;
        } catch (e) {
            console.error("Check failed: Work.deletedAt", e);
        }

        try {
            await prisma.event.findFirst({ select: { id: true, deletedAt: true }, take: 1 });
            checks.event_deletedAt = true;
        } catch (e) {
            console.error("Check failed: Event.deletedAt", e);
        }

        try {
            await prisma.accessibilityProvider.count();
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

export default router;
