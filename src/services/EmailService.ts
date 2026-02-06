import nodemailer from "nodemailer";

interface EmailOptions {
    to: string;
    subject: string;
    html: string;
}

export class EmailService {
    private transporter: nodemailer.Transporter;

    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp.gmail.com",
            port: Number(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }

    async sendEmail({ to, subject, html }: EmailOptions): Promise<void> {
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            console.warn("⚠️ SMTP credentials not set. Email would be sent to:", to);
            console.log("Subject:", subject);
            return;
        }

        try {
            const info = await this.transporter.sendMail({
                from: `Museus App <${process.env.SMTP_USER}>`,
                to,
                subject,
                html,
            });
            console.log("✅ Email sent:", info.messageId);
        } catch (error) {
            console.error("❌ Error sending email:", error);
            throw new Error("Falha ao enviar e-mail");
        }
    }

    async sendPasswordRecovery(to: string, resetLink: string) {
        const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #d4af37; text-align: center;">Recuperação de Senha</h2>
        <p>Olá,</p>
        <p>Recebemos uma solicitação para redefinir a senha da sua conta no <strong>Museus App</strong>.</p>
        <p>Clique no botão abaixo para criar uma nova senha:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background-color: #d4af37; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Redefinir Senha</a>
        </div>
        <p style="color: #666; font-size: 12px;">Se você não solicitou isso, pode ignorar este e-mail. O link expira em 1 hora.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="text-align: center; color: #999; font-size: 12px;">© 2024 Museus App</p>
      </div>
    `;
        await this.sendEmail({ to, subject: "Recuperação de Senha - Museus App", html });
    }
}

export const emailService = new EmailService();
