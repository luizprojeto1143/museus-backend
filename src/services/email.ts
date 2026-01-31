import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export class MailService {
    public transporter: nodemailer.Transporter;

    constructor() {
        // Use environment variables or fallback to Ethereal for dev
        if (process.env.SMTP_HOST) {
            this.transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT) || 587,
                secure: false,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });
        } else {
            console.info("Using Ethereal Mail Mock");
            this.transporter = nodemailer.createTransport({
                host: "smtp.ethereal.email",
                port: 587,
                secure: false, // true for 465, false for other ports
                auth: {
                    user: 'maddison53@ethereal.email', // Mock
                    pass: 'jn7jnAPss4f63QBp6D'
                }
            });
        }
    }

    async sendTicketEmail(
        to: string,
        eventTitle: string,
        guestName: string,
        ticketCode: string,
        eventDate?: string,
        location?: string
    ) {
        try {
            // Generate PDF Buffer
            const pdfBuffer = await this.generateTicketPDF(eventTitle, guestName, ticketCode, eventDate, location);

            const info = await this.transporter.sendMail({
                from: '"Museus Ent" <noreply@museus.ent>',
                to,
                subject: `🎟️ Seu ingresso para ${eventTitle}`,
                html: `
                    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%); border-radius: 16px; overflow: hidden;">
                        <!-- Header -->
                        <div style="height: 4px; background: #f59e0b;"></div>
                        <div style="padding: 40px 30px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0 0 10px 0; font-size: 28px;">🎉 Inscrição Confirmada!</h1>
                            <p style="color: #94a3b8; margin: 0; font-size: 16px;">Seu ingresso está pronto</p>
                        </div>
                        
                        <!-- Content -->
                        <div style="background: #ffffff; padding: 30px; margin: 0 20px 20px 20px; border-radius: 12px;">
                            <h2 style="color: #1e3a8a; margin: 0 0 20px 0; font-size: 22px;">${eventTitle}</h2>
                            
                            <div style="display: flex; gap: 20px; margin-bottom: 20px;">
                                <div style="flex: 1;">
                                    <p style="color: #64748b; font-size: 12px; margin: 0 0 4px 0; text-transform: uppercase;">Participante</p>
                                    <p style="color: #1e293b; font-size: 16px; font-weight: 600; margin: 0;">${guestName}</p>
                                </div>
                                <div style="flex: 1;">
                                    <p style="color: #64748b; font-size: 12px; margin: 0 0 4px 0; text-transform: uppercase;">Código</p>
                                    <p style="color: #f59e0b; font-size: 16px; font-weight: 700; margin: 0;">${ticketCode}</p>
                                </div>
                            </div>
                            
                            ${eventDate ? `<p style="color: #64748b; margin: 10px 0;">📅 <strong style="color: #1e293b;">${eventDate}</strong></p>` : ''}
                            ${location ? `<p style="color: #64748b; margin: 10px 0;">📍 <strong style="color: #1e293b;">${location}</strong></p>` : ''}
                            
                            <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin-top: 20px; text-align: center;">
                                <p style="color: #64748b; font-size: 14px; margin: 0;">📎 Seu ingresso em PDF está anexado a este e-mail</p>
                            </div>
                        </div>
                        
                        <!-- Footer -->
                        <div style="padding: 20px 30px; text-align: center;">
                            <p style="color: #64748b; font-size: 12px; margin: 0;">Apresente o QR Code do ingresso na entrada do evento</p>
                            <p style="color: #475569; font-size: 11px; margin: 10px 0 0 0;">Museus Enterprise</p>
                        </div>
                    </div>
                `,
                attachments: [
                    {
                        filename: `ingresso_${eventTitle.replace(/\s+/g, '_')}.pdf`,
                        content: pdfBuffer
                    }
                ]
            });

            // console.info("Message sent: %s", info.messageId);
        } catch (error) {
            console.error("Email error (non-blocking):", error);
        }
    }

    private async generateTicketPDF(event: string, guest: string, code: string, eventDate?: string, location?: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            try {
                // Ticket size - similar to a real event ticket
                const doc = new PDFDocument({
                    size: [600, 280], // Wide ticket format
                    margins: { top: 0, bottom: 0, left: 0, right: 0 }
                });
                const chunks: Buffer[] = [];

                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                // Initialize async generation
                (async () => {
                    try {
                        // QR Code Generation
                        const qrData = await QRCode.toDataURL(code, {
                            width: 120,
                            margin: 0,
                            color: { dark: '#1e3a8a', light: '#ffffff' }
                        });

                        // === BACKGROUND GRADIENT (Dark Blue to Purple) ===
                        const gradient = doc.linearGradient(0, 0, 600, 280);
                        gradient.stop(0, '#0f172a')   // Slate 900
                            .stop(0.5, '#1e1b4b')  // Indigo 950
                            .stop(1, '#312e81');   // Indigo 900
                        doc.rect(0, 0, 600, 280).fill(gradient);

                        // === DECORATIVE ELEMENTS ===
                        // Top accent line
                        doc.rect(0, 0, 600, 4).fill('#f59e0b'); // Amber accent

                        // Circular pattern (subtle)
                        doc.opacity(0.05);
                        doc.circle(500, 140, 200).fill('#ffffff');
                        doc.circle(-50, 140, 150).fill('#ffffff');
                        doc.opacity(1);

                        // === LEFT SECTION (Main Info) ===
                        // Event Title
                        doc.font('Helvetica-Bold').fontSize(28).fillColor('#ffffff');
                        doc.text(event.toUpperCase(), 30, 35, { width: 380 });

                        // Divider line
                        doc.rect(30, 85, 60, 3).fill('#f59e0b');

                        // Guest Name
                        doc.font('Helvetica').fontSize(12).fillColor('#94a3b8');
                        doc.text('PARTICIPANTE', 30, 105);
                        doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff');
                        doc.text(guest, 30, 120);

                        // Date & Location (if provided)
                        doc.font('Helvetica').fontSize(11).fillColor('#94a3b8');
                        doc.text('DATA', 30, 160);
                        doc.font('Helvetica-Bold').fontSize(14).fillColor('#e2e8f0');
                        doc.text(eventDate || 'A confirmar', 30, 175);

                        doc.font('Helvetica').fontSize(11).fillColor('#94a3b8');
                        doc.text('LOCAL', 30, 205);
                        doc.font('Helvetica-Bold').fontSize(14).fillColor('#e2e8f0');
                        doc.text(location || 'Ver detalhes no app', 30, 220, { width: 200 });

                        // === PERFORATED LINE (Dashed separator) ===
                        doc.strokeColor('#475569').lineWidth(1).dash(5, { space: 5 });
                        doc.moveTo(430, 20).lineTo(430, 260).stroke();
                        doc.undash();

                        // === RIGHT SECTION (QR Code) ===
                        // White background for QR
                        doc.roundedRect(455, 40, 120, 120, 8).fill('#ffffff');

                        // QR Code
                        doc.image(qrData, 460, 45, { width: 110 });

                        // Code text
                        doc.font('Helvetica-Bold').fontSize(14).fillColor('#f59e0b');
                        doc.text(code, 455, 175, { width: 120, align: 'center' });

                        // Instructions
                        doc.font('Helvetica').fontSize(9).fillColor('#64748b');
                        doc.text('Apresente este', 455, 200, { width: 120, align: 'center' });
                        doc.text('QR Code na entrada', 455, 212, { width: 120, align: 'center' });

                        // === BOTTOM BRANDING ===
                        doc.font('Helvetica').fontSize(8).fillColor('#475569');
                        doc.text('Powered by Museus Enterprise', 30, 255);

                        doc.end();
                    } catch (err) {
                        reject(err);
                    }
                })();

            } catch (e) {
                reject(e);
            }
        });
    }

    // Generic Helper
    async sendGenericEmail(to: string, subject: string, html: string) {
        try {
            const info = await this.transporter.sendMail({
                from: '"Museus Ent" <noreply@museus.ent>',
                to,
                subject,
                html
            });
            // console.info("Generic email sent: %s", info.messageId);
            return true;
        } catch (error) {
            console.error("Generic email error:", error);
            return false;
        }
    }

    async sendAccessibilityAlert(type: "NEW_REQUEST" | "UPDATED", data: any) {
        // Mock Master Email
        const MASTER_EMAIL = "master@museus.ent";

        if (type === "NEW_REQUEST") {
            const subject = `♿ Nova Solicitação: ${data.workTitle}`;
            const html = `
                <h2>Nova Solicitação de Acessibilidade</h2>
                <p><strong>Museu:</strong> ${data.tenantName}</p>
                <p><strong>Obra:</strong> ${data.workTitle}</p>
                <p><strong>Tipo:</strong> ${data.type}</p>
                <p><strong>Solicitante:</strong> ${data.requestedBy}</p>
                <p><strong>Notas:</strong> ${data.notes || "Nenhuma"}</p>
            `;
            await this.sendGenericEmail(MASTER_EMAIL, subject, html);
        } else if (type === "UPDATED") {
            const subject = `✅ Solicitação Atendida: ${data.workTitle}`;
            const html = `
                <h2>Solicitação de Acessibilidade Concluída</h2>
                <p>Sua solicitação para a obra <strong>${data.workTitle}</strong> foi processada.</p>
                <p><strong>Status:</strong> CONCLUÍDO</p>
                <p>Os recursos de acessibilidade já estão vinculados à obra.</p>
                <br/>
                <p><em>Equipe Museus Enterprise</em></p>
            `;
            await this.sendGenericEmail(data.requestedBy, subject, html);
        }
    }
}

export const mailService = new MailService();

// Certificate Functions (used by events.ts)
export async function generateCertificateBuffer(
    visitorName: string,
    eventTitle: string,
    date: string,
    tenantName: string,
    code: string,
    logoUrl?: string | null,
    signatureUrl?: string | null,
    backgroundUrl?: string | null
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', layout: 'landscape' });
            const chunks: Buffer[] = [];

            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Background
            doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f8f9fa');

            // Border
            doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60).lineWidth(3).stroke('#d4af37');

            // Title
            doc.fillColor('#1e3a8a').fontSize(36).text('CERTIFICADO', 0, 100, { align: 'center' });

            // Body
            doc.fillColor('#333').fontSize(16).text(
                `Certificamos que ${visitorName} participou do evento "${eventTitle}" realizado em ${date}, promovido por ${tenantName}.`,
                80, 200, { align: 'center', width: doc.page.width - 160 }
            );

            // Code
            doc.fontSize(12).text(`Código de Verificação: ${code}`, 0, 350, { align: 'center' });

            // Footer
            doc.fontSize(10).fillColor('#666').text(tenantName, 0, 400, { align: 'center' });

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

export async function sendCertificateEmail(
    to: string,
    visitorName: string,
    eventTitle: string,
    date: string,
    tenantName: string,
    code: string,
    logoUrl?: string | null,
    signatureUrl?: string | null,
    backgroundUrl?: string | null
): Promise<boolean> {
    try {
        const pdfBuffer = await generateCertificateBuffer(
            visitorName, eventTitle, date, tenantName, code, logoUrl, signatureUrl, backgroundUrl
        );

        await mailService.transporter.sendMail({
            from: `"${tenantName}" <noreply@museus.ent>`,
            to,
            subject: `Seu Certificado - ${eventTitle}`,
            html: `
                <div style="font-family: Arial, sans-serif; color: #333;">
                    <h1>Parabéns, ${visitorName}!</h1>
                    <p>Seu certificado de participação no evento <strong>${eventTitle}</strong> está em anexo.</p>
                    <p>Código de verificação: <strong>${code}</strong></p>
                </div>
            `,
            attachments: [
                { filename: `certificado_${eventTitle.replace(/\s+/g, '_')}.pdf`, content: pdfBuffer }
            ]
        });

        return true;
    } catch (e) {
        console.error("Certificate email error:", e);
        return false;
    }
}

