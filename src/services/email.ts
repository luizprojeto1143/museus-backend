import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

// Configuração do transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true", // true para 465, false para outros
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

import axios from "axios";

// Helper para baixar imagem
const fetchImageBuffer = async (url?: string | null): Promise<Buffer | null> => {
    if (!url) return null;
    try {
        const response = await axios.get(url, { responseType: "arraybuffer" });
        return Buffer.from(response.data);
    } catch (e) {
        console.warn("Falha ao baixar imagem para certificado:", url);
        return null;
    }
};

export const generateCertificateBuffer = async (
    visitorName: string,
    eventName: string,
    date: string,
    organizerName: string,
    verificationCode?: string,
    logoUrl?: string | null,
    signatureUrl?: string | null,
    backgroundUrl?: string | null
): Promise<Buffer> => {
    // Carregar imagens em paralelo
    const [logoBuffer, signatureBuffer, backgroundBuffer] = await Promise.all([
        fetchImageBuffer(logoUrl),
        fetchImageBuffer(signatureUrl),
        fetchImageBuffer(backgroundUrl)
    ]);

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ layout: "landscape", size: "A4", margin: 40 });
            const buffers: Buffer[] = [];

            doc.on("data", (buffer) => buffers.push(buffer));
            doc.on("end", () => resolve(Buffer.concat(buffers)));
            doc.on("error", (err) => reject(err));

            const centerX = doc.page.width / 2;
            const centerY = doc.page.height / 2;

            // Fundo
            if (backgroundBuffer) {
                // Desenhar imagem de fundo cobrindo tudo
                doc.image(backgroundBuffer, 0, 0, { width: doc.page.width, height: doc.page.height });
            } else {
                // Design Padrão
                doc.rect(0, 0, doc.page.width, doc.page.height).fill("#fdfdfd");
                doc.lineWidth(3).rect(20, 20, doc.page.width - 40, doc.page.height - 40).stroke("#d4af37"); // Borda Externa
                doc.lineWidth(1).rect(25, 25, doc.page.width - 50, doc.page.height - 50).stroke("#e5e7eb"); // Borda Interna sutil
            }

            let currentY = 60;

            // LOGO (Se tiver fundo personalizado, talvez o logo já esteja lá? Mas vamos manter a opção de sobrepor se a URL do logo for passada)
            if (logoBuffer) {
                const logoWidth = 100;
                doc.image(logoBuffer, centerX - (logoWidth / 2), currentY, { width: logoWidth });
                currentY += 80;
            } else {
                currentY += 40;
            }

            doc.moveDown(0);
            doc.y = currentY;

            // Ajustar cores baseadas no fundo? Por enquanto manter cores escuras/padrão.
            // Se tiver fundo, talvez o texto precise ser branco? Impossível saber sem input do usuário.
            // Vou assumir que o fundo é claro (papel, pergaminho).

            doc.font("Helvetica-Bold").fontSize(36).fillColor("#1f2937").text("CERTIFICADO", { align: "center" });
            doc.fontSize(14).font("Helvetica").fillColor("#d4af37").text("DE PARTICIPAÇÃO", { align: "center", characterSpacing: 2 });

            doc.moveDown(2);
            doc.fontSize(16).font("Helvetica").fillColor("#4b5563").text("Certificamos que", { align: "center" });

            doc.moveDown(0.5);
            doc.fontSize(28).font("Helvetica-Bold").fillColor("#d4af37").text(visitorName, { align: "center" });

            doc.moveDown(0.5);
            doc.fontSize(16).font("Helvetica").fillColor("#4b5563").text(`participou do evento realizado por ${organizerName}:`, { align: "center" });

            doc.moveDown(0.5);
            doc.fontSize(22).font("Helvetica-Bold").fillColor("#1f2937").text(eventName, { align: "center" });

            doc.moveDown(1.5);
            doc.fontSize(14).font("Helvetica").fillColor("#6b7280").text(`Realizado em: ${date}`, { align: "center" });

            // ASSINATURA AREA
            const signatureY = doc.page.height - 130;

            if (signatureBuffer) {
                const sigWidth = 120;
                doc.image(signatureBuffer, centerX - (sigWidth / 2), signatureY - 50, { width: sigWidth });
            }

            // Linha da assinatura
            doc.moveTo(centerX - 100, signatureY)
                .lineTo(centerX + 100, signatureY)
                .strokeColor("#9ca3af")
                .lineWidth(1)
                .stroke();

            doc.fontSize(12).font("Helvetica-Bold").fillColor("#374151").text(organizerName, centerX - 100, signatureY + 10, { width: 200, align: "center" });
            doc.fontSize(10).font("Helvetica").fillColor("#9ca3af").text("Organizador", centerX - 100, signatureY + 25, { width: 200, align: "center" });

            if (verificationCode) {
                const codeY = doc.page.height - 40;
                doc.fontSize(9).font("Courier").fillColor("#9ca3af").text(`Código de Verificação: ${verificationCode}`, 0, codeY, { align: "right", width: doc.page.width - 40 });
            }

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
};

export const sendCertificateEmail = async (
    toEmail: string,
    visitorName: string,
    eventName: string,
    date: string,
    organizerName: string,
    verificationCode?: string,
    logoUrl?: string | null,
    signatureUrl?: string | null,
    backgroundUrl?: string | null
): Promise<boolean> => {
    try {
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            console.warn("⚠️ SMTP credentials not found. Skipping email sending.");
            console.log(`[MOCK EMAIL] To: ${toEmail}, Subject: Certificado - ${eventName}`);
            return true;
        }

        const pdfData = await generateCertificateBuffer(
            visitorName,
            eventName,
            date,
            organizerName,
            verificationCode,
            logoUrl,
            signatureUrl,
            backgroundUrl
        );

        // Enviar E-mail
        await transporter.sendMail({
            from: `"Museus - ${organizerName}" <${process.env.SMTP_USER}>`,
            to: toEmail,
            subject: `Seu Certificado: ${eventName}`,
            text: `Olá ${visitorName},\n\nObrigado por participar do evento "${eventName}".\n\nSeu certificado está em anexo.\n\nAtenciosamente,\n${organizerName}`,
            html: `<p>Olá <strong>${visitorName}</strong>,</p><p>Obrigado por participar do evento "<strong>${eventName}</strong>".</p><p>Seu certificado está em anexo.</p><br><p>Atenciosamente,<br>${organizerName}</p>`,
            attachments: [
                {
                    filename: `Certificado_${eventName.replace(/\s+/g, "_")}.pdf`,
                    content: pdfData,
                    contentType: "application/pdf",
                },
            ],
        });
        console.log(`✅ Certificado enviado para ${toEmail}`);
        return true;
    } catch (error) {
        console.error("❌ Erro ao enviar e-mail:", error);
        return false;
    }
};
