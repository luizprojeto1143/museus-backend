import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// Full System Backup (Admin Only)
// Exports critical JSON data for disaster recovery
router.get("/full", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === Role.MASTER ? undefined : user.tenantId;

        // 1. Fetch Critical Data (Scoped by Tenant if not Master)
        const whereClause = tenantId ? { tenantId } : {};
        const eventWhere = tenantId ? { tenantId } : {};
        const visitorWhere = tenantId ? { tenantId } : {};

        const data = {
            metadata: {
                exportedBy: user.email,
                date: new Date().toISOString(),
                scope: tenantId || "GLOBAL",
                lgpdNotice: "Dados pessoais de visitantes foram anonimizados conforme LGPD"
            },
            tenants: await prisma.tenant.findMany({ where: tenantId ? { id: tenantId } : {} }),
            events: await prisma.event.findMany({ where: eventWhere }),
            tickets: await prisma.ticket.findMany({ where: { event: eventWhere } }),
            registrations: await prisma.registration.findMany({ where: { event: eventWhere } }),
            // LGPD: Strip PII from visitor data (emails, CPF, phones, IPs)
            visitors: (await prisma.visitor.findMany({ where: visitorWhere })).map(v => ({
                id: v.id,
                name: v.name,
                tenantId: v.tenantId,
                xp: v.xp,
                createdAt: v.createdAt,
                // Exclude: email, cpf, phone, termsAcceptedIp
            })),
            works: await prisma.work.findMany({ where: whereClause })
        };

        // 2. Return as Downloadable JSON
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="backup_${tenantId || 'global'}_${Date.now()}.json"`);

        return res.send(JSON.stringify(data, null, 2));

    } catch (err) {
        console.error("Backup failed", err);
        return res.status(500).json({ message: "Falha ao gerar backup" });
    }
});

export default router;
