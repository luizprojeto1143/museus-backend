import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Public Certificate Validation Route
router.get('/:code', async (req, res) => {
    try {
        const { code } = req.params;

        if (!code) {
            return res.status(400).json({ valid: false, message: 'Código não fornecido' });
        }

        const cert = await prisma.certificate.findUnique({
            where: { code },
            include: {
                visitor: {
                    select: { name: true }
                },
                tenant: {
                    select: { name: true, logoUrl: true }
                }
            }
        });

        if (!cert) {
            return res.status(404).json({ valid: false, message: 'Certificado não encontrado' });
        }

        // Extract Title from Metadata
        const meta = cert.metadata as { title?: string; date?: string;[key: string]: any } || {};
        const title = meta?.title || (cert.type === 'TRAIL' ? 'Trilha Cultural' : 'Evento Cultural');

        return res.json({
            valid: true,
            data: {
                id: cert.id,
                code: cert.code,
                visitorName: cert.visitor.name,
                issuerName: cert.tenant.name,
                issuerLogo: cert.tenant.logoUrl,
                title: title,
                type: cert.type,
                issuedAt: cert.generatedAt,
                description: meta?.description || `Certificado de conclusão de ${title}`
            }
        });

    } catch (error) {
        console.error('Error validating certificate:', error);
        return res.status(500).json({ valid: false, message: 'Erro interno ao validar certificado' });
    }
});

export default router;
