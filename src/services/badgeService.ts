import PDFDocument from 'pdfkit';
import { prisma } from '../prisma.js';
import axios from 'axios';

export class BadgeService {
    /**
     * Generates a physical badge PDF for an ambassador
     */
    static async generatePDF(requestId: string): Promise<Buffer> {
        const request = await (prisma as any).badgeRequest.findUnique({
            where: { id: requestId },
            include: {
                visitor: {
                    include: {
                        vRPGs: {
                            where: { isActive: true },
                            include: { equippedSkin: true }
                        }
                    }
                },
                tenant: true
            }
        });

        if (!request) throw new Error("Badge request not found");

        // CRITICAL: CR85 size is 85.6mm x 53.98mm (standard credit card)
        // PDFKit points: 1mm = 2.83465 points
        // Width: 85.6 * 2.83465 = 242.6 points
        // Height: 54 * 2.83465 = 153 points
        const doc = new PDFDocument({
            size: [153, 242.6], // Vertical orientation for badge
            margin: 0
        });

        const avatarUrl = request.skinImageUrl || 'https://museus.app/default_avatar.png';
        let avatarData: any = null;
        try {
            const avatarRes = await axios.get(avatarUrl, { responseType: 'arraybuffer' });
            avatarData = avatarRes.data;
        } catch (e) {
            console.error("Failed to load badge avatar", e);
        }

        const buffers: Buffer[] = [];
        doc.on('data', buffers.push.bind(buffers));

        return new Promise((resolve, reject) => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);

            try {
                // 1. Background Gradient (Simulated via rects)
                doc.rect(0, 0, 153, 242.6).fill('#0f172a'); // Slate-900

                // 2. Accent Header
                const accentColor = request.level === 4 ? '#fbbf24' : // Gold
                                  request.level === 3 ? '#a78bfa' : // Purple
                                  request.level === 2 ? '#60a5fa' : // Blue
                                  '#fb923c'; // Bronze
                
                doc.rect(0, 0, 153, 5).fill(accentColor);

                // 3. Visitor Avatar
                if (avatarData) {
                    // Avatar Box
                    doc.roundedRect(26.5, 30, 100, 100, 20).fill('#1e293b');
                    doc.image(avatarData, 31.5, 35, { width: 90, height: 90 });
                } else {
                    doc.roundedRect(26.5, 30, 100, 100, 20).fill('#1e293b');
                    doc.fontSize(30).fillColor('#475569').text('👤', 60, 65);
                }

                // 4. Name
                doc.font('Helvetica-Bold')
                   .fontSize(14)
                   .fillColor('#ffffff')
                   .text(request.addressName.split(' ')[0].toUpperCase(), 10, 145, { width: 133, align: 'center' });

                // 5. Title / Role
                doc.font('Helvetica')
                   .fontSize(7)
                   .fillColor(accentColor)
                   .text('EMBAIXADOR CULTURAL', 0, 162, { width: 153, align: 'center', characterSpacing: 1 });

                // 6. Level Info
                const levelName = request.level === 4 ? "PLATINA" : request.level === 3 ? "OURO" : request.level === 2 ? "PRATA" : "BRONZE";
                doc.font('Helvetica-Bold')
                   .fontSize(6)
                   .fillColor('#94a3b8')
                   .text(`NÍVEL ${levelName}`, 0, 172, { width: 153, align: 'center', characterSpacing: 2 });

                // 7. Museum Info (Small footer)
                doc.font('Helvetica')
                   .fontSize(5)
                   .fillColor('#475569')
                   .text(request.tenant?.name?.toUpperCase() || 'SISTEMA CULTURA VIVA', 10, 210, { width: 133, align: 'center' });

                // 8. Security/ID info
                doc.fontSize(4)
                   .fillColor('#334155')
                   .text(`REQ-ID: ${request.id.substring(0,8).toUpperCase()} | ISSUED: 2026`, 10, 230, { width: 133, align: 'center' });

                // 9. QR Code (Minimalistic)
                // In a production environment, we could add a tiny QR here to verify the ambassador profile
                
                doc.end();

            } catch (err) {
                reject(err);
            }
        });
    }
}
