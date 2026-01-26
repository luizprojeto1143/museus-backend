import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { z } from "zod";

const router = Router();

// Create Request (ADMIN)
router.post("/", authMiddleware, requireRole([Role.ADMIN]), async (req, res) => {
    try {
        const { workId, type, notes } = req.body;
        const user = req.user!;

        if (!workId || !type) {
            return res.status(400).json({ message: "Work ID and Type are required" });
        }

        // Verify ownership
        const work = await prisma.work.findUnique({ where: { id: workId } });
        if (!work || work.tenantId !== user.tenantId) {
            return res.status(403).json({ message: "Work not found or access denied" });
        }

        const request = await prisma.accessibilityRequest.create({
            data: {
                workId,
                tenantId: user.tenantId,
                type, // LIBRAS, AUDIO_DESC, BOTH
                notes,
                requestedBy: user.email,
                status: "PENDING"
            },
            include: { work: true }
        });

        // TODO: Send email to Master
        console.log(`[Email Mock] New Accessibility Request from ${user.tenantId} for work ${work.title}`);

        return res.status(201).json(request);
    } catch (err) {
        console.error("Error creating accessibility request", err);
        return res.status(500).json({ message: "Error creating request" });
    }
});

// List Requests (MASTER)
router.get("/master", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
    try {
        const requests = await prisma.accessibilityRequest.findMany({
            orderBy: { createdAt: "desc" },
            include: {
                work: { select: { title: true, id: true } },
                tenant: { select: { name: true, slug: true } }
            }
        });
        return res.json(requests);
    } catch (err) {
        console.error("Error listing requests", err);
        return res.status(500).json({ message: "Error listing requests" });
    }
});

// Fulfill Request (MASTER) - Upload is handled by frontend (to storage), updates URL here
router.post("/:id/fulfill", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const { fileUrl, fileType, masterNotes } = req.body; // fileType: 'LIBRAS' or 'AUDIO'

        const request = await prisma.accessibilityRequest.findUnique({ where: { id } });
        if (!request) {
            return res.status(404).json({ message: "Request not found" });
        }

        // Update Work
        const updateData: any = {};
        if (fileType === "LIBRAS") updateData.librasUrl = fileUrl;
        if (fileType === "AUDIO") updateData.audioUrl = fileUrl;

        await prisma.$transaction([
            prisma.work.update({
                where: { id: request.workId },
                data: updateData
            }),
            prisma.accessibilityRequest.update({
                where: { id },
                data: {
                    status: "COMPLETED",
                    masterNotes
                }
            })
        ]);

        return res.json({ message: "Request fulfilled and work updated" });
    } catch (err) {
        console.error("Error fulfilling request", err);
        return res.status(500).json({ message: "Error fulfilling request" });
    }
});

export default router;
