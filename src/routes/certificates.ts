import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { CertificateService } from '../services/certificate';
import { authMiddleware } from '../middleware/auth'; // Assumptions based on existing files
import { z } from 'zod'; // Assuming zod is usedProject

const router = Router();
const prisma = new PrismaClient();

// Generate Certificate (User triggers this after completing criteria)
router.post('/generate', authMiddleware, async (req, res) => {
    try {
        const { type, relatedId } = req.body;
        const visitorId = req.user?.id;
        const tenantId = req.user?.tenantId;

        if (!visitorId || !tenantId) return res.status(401).json({ message: "Unauthorized" });

        // TODO: Validate eligibility criteria here (e.g. check if trail is completed)
        // For now, we assume frontend only calls this when allowed.

        // Check if already exists
        const existing = await prisma.certificate.findFirst({
            where: { visitorId, type, relatedId }
        });

        if (existing) {
            return res.json(existing);
        }

        // Fetch Metadata
        let metadata = {};
        if (type === 'EVENT') {
            const event = await prisma.event.findUnique({ where: { id: relatedId } });
            if (event) metadata = { title: event.title, date: event.startDate };
        } else if (type === 'TRAIL') {
            const trail = await prisma.trail.findUnique({ where: { id: relatedId } });
            if (trail) metadata = { title: trail.title };
        }

        const code = CertificateService.generateCode();

        const cert = await prisma.certificate.create({
            data: {
                code,
                visitorId,
                tenantId,
                type,
                relatedId,
                metadata,
                status: 'VALID'
            }
        });

        return res.status(201).json(cert);

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Erro ao gerar certificado" });
    }
});

// List My Certificates
router.get('/mine', authMiddleware, async (req, res) => {
    try {
        const visitorId = req.user?.id;
        if (!visitorId) return res.status(401).json({ message: "Unauthorized" });

        const certs = await prisma.certificate.findMany({
            where: { visitorId },
            orderBy: { generatedAt: 'desc' },
            include: { tenant: { select: { name: true } } }
        });

        return res.json(certs);
    } catch (err) {
        return res.status(500).json({ message: "Erro ao listar certificados" });
    }
});

// Download PDF
router.get('/:id/pdf', async (req, res) => {
    try {
        // Public or protected? Certificates are validatable publicly, but downloading the PDF might need ownership? 
        // For simplicity, let's allow if you have the ID (UUID is secret enough) OR prevent caching.
        // Better: authenticated if user, or public if we want. Let's start public-ish but obscure ID.

        const { id } = req.params;
        const pdfBuffer = await CertificateService.generatePDF(id);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=certificado-${id}.pdf`);
        return res.send(pdfBuffer);

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Erro ao gerar PDF" });
    }
});

// Public Verification Data
router.get('/verify/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const cert = await prisma.certificate.findUnique({
            where: { code },
            include: {
                visitor: { select: { name: true } },
                tenant: { select: { name: true } }
            }
        });

        if (!cert) return res.status(404).json({ valid: false, message: "Certificado não encontrado" });

        return res.json({
            valid: cert.status === 'VALID',
            visitorName: cert.visitor.name,
            tenantName: cert.tenant.name,
            type: cert.type,
            metadata: cert.metadata,
            generatedAt: cert.generatedAt,
            revoked: cert.status === 'REVOKED'
        });
    } catch (err) {
        return res.status(500).json({ message: "Erro ao verificar" });
    }
});

export default router;
