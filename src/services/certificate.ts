import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

export class CertificateService {
    /**
     * Generates a unique 12-char alphanumeric code
     */
    static generateCode(): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1
        let code = '';
        for (let i = 0; i < 12; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code.match(/.{1,4}/g)?.join('-') || code;
    }

    /**
     * Generates a PDF certificate
     */
    static async generatePDF(certificateId: string): Promise<Buffer> {
        const cert = await prisma.certificate.findUnique({
            where: { id: certificateId },
            include: {
                visitor: true,
                tenant: true
            }
        });

        if (!cert) throw new Error("Certificate not found");

        const doc = new PDFDocument({
            layout: 'landscape',
            size: 'A4',
            margin: 0
        });

        const buffers: Buffer[] = [];
        doc.on('data', buffers.push.bind(buffers));

        return new Promise(async (resolve, reject) => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);

            try {
                // 1. Background
                let backgroundUrl = cert.tenant.certificateBackgroundUrl;

                // Override if event specific
                if (cert.type === 'EVENT' && cert.relatedId) {
                    const event = await prisma.event.findUnique({ where: { id: cert.relatedId } });
                    if (event?.certificateBackgroundUrl) {
                        backgroundUrl = event.certificateBackgroundUrl;
                    }
                }

                if (backgroundUrl) {
                    try {
                        const bgResponse = await axios.get(backgroundUrl, { responseType: 'arraybuffer' });
                        doc.image(bgResponse.data, 0, 0, { width: 841.89, height: 595.28 });
                    } catch (e) {
                        console.error("Failed to load background, using white", e);
                        // Fallback visual
                        doc.rect(0, 0, 841.89, 595.28).fill('#fdfbf7');
                        doc.lineWidth(10).strokeColor('#d4af37').rect(20, 20, 801, 555).stroke();
                    }
                } else {
                    // Default elegant border
                    doc.rect(0, 0, 841.89, 595.28).fill('#fdfbf7'); // Off-white
                    doc.lineWidth(10).strokeColor('#d4af37').rect(20, 20, 801, 555).stroke(); // Gold border
                }

                // 2. Content
                doc.font('Helvetica-Bold').fontSize(40).fillColor('#2c3e50')
                    .text('CERTIFICADO', 0, 100, { align: 'center' });

                doc.font('Helvetica').fontSize(20).fillColor('#34495e')
                    .text('Certificamos que', 0, 180, { align: 'center' });

                doc.font('Helvetica-Bold').fontSize(35).fillColor('#000000')
                    .text(cert.visitor.name || 'Visitante', 0, 220, { align: 'center' });

                // Generate description based on type
                let description = 'concluiu com êxito a participação nas atividades culturais.';
                if (cert.type === 'EVENT') {
                    // Fetch event name from metadata or DB
                    // Simple approach: look at metadata
                    const data = cert.metadata as any;
                    const title = data?.title || 'Evento Cultural';
                    description = `participou do evento "${title}".`;
                } else if (cert.type === 'TRAIL') {
                    const data = cert.metadata as any;
                    const title = data?.title || 'Trilha Cultural';
                    description = `concluiu a trilha "${title}".`;
                }

                doc.font('Helvetica').fontSize(20).fillColor('#34495e')
                    .text(description, 100, 280, { align: 'center', width: 640 });

                // 3. Metadata (Date, Tenant)
                doc.fontSize(14).text(`Data: ${cert.generatedAt.toLocaleDateString('pt-BR')}`, 100, 400);
                doc.text(`Emissor: ${cert.tenant.name}`, 100, 420);
                doc.text(`Código: ${cert.code}`, 100, 440);

                // 4. QR Code
                const verifyUrl = `${process.env.FRONTEND_URL || 'https://museus.app'}/verify/${cert.code}`;
                const qrBuffer = await QRCode.toBuffer(verifyUrl);

                doc.image(qrBuffer, 650, 380, { width: 120, height: 120 });
                doc.fontSize(10).text('Verifique a autenticidade', 650, 510, { width: 120, align: 'center' });

                doc.end();

            } catch (err) {
                reject(err);
            }
        });
    }
}
