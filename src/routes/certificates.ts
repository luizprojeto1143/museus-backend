import { Router } from 'express';
import { prisma } from '../prisma.js';
import { CertificateService } from '../services/certificate.js';
import { authMiddleware } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimiter.js';
import { z } from 'zod';

const router = Router();

// Generate Certificate (User triggers this after completing criteria)
// SECURITY: Rate Limit prevent PDF DoS (CRIT-007)
router.post('/generate', authMiddleware, limiter, async (req, res) => {
    try {
        const { type, relatedId } = req.body;
        const userId = req.user?.id;
        const userEmail = req.user?.email;
        const tenantId = req.user?.tenantId;

        if (!userId || !tenantId || !userEmail) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        // BUGFIX: Find the Visitor entity for this User (they are different entities)
        const visitor = await prisma.visitor.findFirst({
            where: { email: userEmail, tenantId }
        });

        if (!visitor) {
            return res.status(404).json({ message: "Perfil de visitante não encontrado. Visite o museu primeiro." });
        }

        const visitorId = visitor.id;

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
            if (!event) {
                return res.status(404).json({ message: "Evento não encontrado" });
            }
            // Impedir certificado antes do evento terminar
            const eventEndDate = event.endDate || event.startDate;
            if (new Date() < new Date(eventEndDate)) {
                return res.status(400).json({
                    message: "Certificado só pode ser gerado após o término do evento"
                });
            }
            metadata = { title: event.title, date: event.startDate };

            // Check if Survey is required
            if (event.certificateRequiresSurvey) {
                const hasResponse = await prisma.surveyResponse.findFirst({
                    where: {
                        visitorId: visitorId,
                        question: {
                            eventId: relatedId
                        }
                    }
                });

                if (!hasResponse) {
                    return res.status(403).json({
                        message: "É necessário responder à pesquisa de satisfação para emitir o certificado.",
                        requiresSurvey: true,
                        eventId: relatedId
                    });
                }
            }
        } else if (type === 'TRAIL') {
            const trail = await prisma.trail.findUnique({ where: { id: relatedId } });
            if (trail) metadata = { title: trail.title };
        }

        // Generate Code with Retry logic (CODE-006)
        let cert;
        let attempts = 0;
        const MAX_ATTEMPTS = 3;

        while (!cert && attempts < MAX_ATTEMPTS) {
            try {
                const code = CertificateService.generateCode();
                cert = await prisma.certificate.create({
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
            } catch (err: unknown) {
                // Check for Unique Constraint Violation (P2002)
                if ((err as any)?.code === 'P2002') {
                    attempts++;
                    console.warn(`Certificate code collision detected. Retrying ${attempts}/${MAX_ATTEMPTS}...`);
                    if (attempts === MAX_ATTEMPTS) throw new Error("Failed to generate unique certificate code after retries.");
                } else {
                    throw err;
                }
            }
        }

        return res.status(201).json(cert);

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Erro ao gerar certificado" });
    }
});

// List My Certificates
router.get('/mine', authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const { tenantId } = req.query;

        // CRITICAL FIX: Find visitor by user's email
        const whereClause: { email: string; tenantId?: string } = {
            email: user.email.toLowerCase()
        };
        if (tenantId) {
            whereClause.tenantId = tenantId as string;
        }

        const visitor = await prisma.visitor.findFirst({
            where: whereClause
        });

        if (!visitor) {
            return res.json([]); // No visitor profile = no certificates
        }

        const certs = await prisma.certificate.findMany({
            where: { visitorId: visitor.id },
            orderBy: { generatedAt: 'desc' },
            include: { tenant: { select: { name: true } } }
        });

        return res.json(certs);
    } catch (err) {
        return res.status(500).json({ message: "Erro ao listar certificados" });
    }
});

// Download PDF
// SECURITY: Rate Limit prevent Resource Exhaustion (CRIT-007)
router.get('/:id/pdf', limiter, async (req, res) => {
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

        // Fetch context (Event or Trail title)
        let relatedTitle = "Atividade da Instituição";
        if (cert.type === 'EVENT' && cert.relatedId) {
            const event = await prisma.event.findUnique({ where: { id: cert.relatedId }, select: { title: true } });
            if (event) relatedTitle = event.title;
        } else if (cert.type === 'TRAIL' && cert.relatedId) {
            const trail = await prisma.trail.findUnique({ where: { id: cert.relatedId }, select: { title: true } });
            if (trail) relatedTitle = trail.title;
        }

        return res.json({
            valid: cert.status === 'VALID',
            visitorName: cert.visitor.name,
            tenantName: cert.tenant.name,
            title: relatedTitle, // Enhanced UX: Show what the cert is FOR
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
