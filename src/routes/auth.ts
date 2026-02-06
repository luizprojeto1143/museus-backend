import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma.js";
import { Role } from "@prisma/client";
import { validate } from "../middleware/validate.js";
import { loginSchema, registerSchema, switchTenantSchema } from "../schemas/auth.schema.js";
import { authMiddleware } from "../middleware/auth.js";
import { limiter } from "../middleware/rateLimiter.js";
import crypto from "crypto";

const router = Router();

// SECURITY: JWT_SECRET must be set
// SECURITY: JWT_SECRET must be set (validated on boot)
const JWT_SECRET = process.env.JWT_SECRET!;
// Access Token: 15 minutos (Curta duração para segurança)
const ACCESS_TOKEN_EXPIRES_IN = "15m";
// Refresh Token: 7 dias (Longa duração para UX)
const REFRESH_TOKEN_EXPIRES_DAYS = 7;

// Helper para gerar tokens
const generateTokens = async (userId: string, email: string, role: Role, tenantId: string | null, tenantType: any) => {
  // 1. Gera Access Token (JWT)
  const accessToken = jwt.sign(
    { email, role, tenantId, type: tenantType },
    JWT_SECRET as jwt.Secret,
    { subject: userId, expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );

  // 2. Gera Refresh Token (Opaque String)
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);

  // 3. Salva Refresh Token no Banco
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: userId,
      expiresAt: expiresAt
    }
  });

  return { accessToken, refreshToken };
};

// Login
router.post("/login", limiter, validate(loginSchema), async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: { select: { type: true } } }
    });

    if (!user) {
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    // Gerar Tokens
    const { accessToken, refreshToken } = await generateTokens(
      user.id,
      user.email,
      user.role,
      user.tenantId,
      user.tenant?.type
    );

    return res.json({
      accessToken,
      refreshToken,
      role: user.role,
      tenantId: user.tenantId,
      tenantType: user.tenant?.type,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        tenantType: user.tenant?.type
      }
    });
  } catch (err) {
    console.error("Erro login", err);
    return res.status(500).json({ message: "Erro ao autenticar" });
  }
});

// Refresh Token Endpoint
router.post("/refresh", async (req: Request, res: Response): Promise<any> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: "Refresh Token é obrigatório" });
    }

    // 1. Busca token no banco
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: { include: { tenant: true } } }
    });

    if (!storedToken) {
      return res.status(401).json({ message: "Token inválido" });
    }

    // 2. Verifica se foi revogado ou expirou
    if (storedToken.revoked || new Date() > storedToken.expiresAt) {
      return res.status(401).json({ message: "Token expirado ou revogado. Faça login novamente." });
    }

    // 3. Rotação de Token (Revoga o atual e cria um novo par)
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true }
    });

    // 4. Gera novos tokens
    const newTokens = await generateTokens(
      storedToken.userId,
      storedToken.user.email,
      storedToken.user.role,
      storedToken.user.tenantId,
      storedToken.user.tenant?.type
    );

    return res.json({
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken
    });

  } catch (err) {
    console.error("Erro no refresh", err);
    return res.status(500).json({ message: "Erro ao renovar token" });
  }
});

// Logout (Revoke)
router.post("/logout", async (req: Request, res: Response): Promise<any> => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken },
        data: { revoked: true }
      });
    }
    return res.status(200).json({ message: "Logout realizado com sucesso" });
  } catch (err) {
    console.error("Erro logout", err);
    return res.status(500).json({ message: "Erro ao realizar logout" });
  }
});

router.post("/recover-password", limiter, async (req: Request, res: Response): Promise<any> => {
  try {
    const { email } = req.body;
    // In a real app, generate token and send email
    console.log(`[MOCKED] Password recovery requested for: ${email}`);

    // Always return success to prevent email enumeration
    return res.status(200).json({ message: "Se o e-mail existir, as instruções foram enviadas." });
  } catch (err) {
    console.error("Erro recover-password", err);
    return res.status(500).json({ message: "Erro ao processar solicitação" });
  }
});

router.post("/register", limiter, validate(registerSchema), async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password, name, tenantId, role, cpf, phone, bio, website } = req.body;

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return res.status(400).json({ message: "Email já cadastrado" });
    }

    // Capture IP
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
    const ipString = Array.isArray(ip) ? ip[0] : ip;

    // Validate role (only allow VISITOR or PRODUCER for public registration)
    // Admin/Master creation is handled separately
    let userRole: Role = Role.VISITOR;
    let newTenantId = tenantId || null;

    if (role === Role.PRODUCER) {
      userRole = Role.PRODUCER;

      // Create a Tenant for the Producer
      const newTenant = await prisma.tenant.create({
        data: {
          name: name, // Producer Name acts as Tenant Name
          type: "PRODUCER", // Using string if enum is not imported, or TenantType.PRODUCER
          slug: name.toLowerCase().replace(/ /g, "-").replace(/[^\w-]+/g, "") + "-" + Date.now().toString().slice(-4),
          featureProjects: true,
          featureServices: true,
          featureTickets: false,
          featureGamification: false
        }
      });
      newTenantId = newTenant.id;
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hash,
        name,
        role: userRole,
        tenantId: tenantId || null,
        termsAcceptedAt: new Date(),
        termsAcceptedIp: String(ipString),
        cpf,
        phone,
        bio,
        website
      }
    });

    const { accessToken, refreshToken } = await generateTokens(user.id, user.email, user.role, user.tenantId, null);

    return res.status(201).json({
      accessToken,
      refreshToken,
      role: user.role,
      tenantId: user.tenantId,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId
      }
    });
  } catch (err) {
    console.error("Erro register", err);
    return res.status(500).json({ message: "Erro ao criar conta" });
  }
});

router.post("/switch-tenant", authMiddleware, validate(switchTenantSchema), async (req: any, res: any) => {
  try {
    const { targetTenantId } = req.body;
    const userId = req.user?.id;

    if (!targetTenantId || !userId) {
      return res.status(400).json({ message: "Tenant ID e User ID são obrigatórios" });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: targetTenantId } });
    if (!tenant) {
      return res.status(404).json({ message: "Museu não encontrado" });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { tenantId: targetTenantId }
    });

    let visitor = await prisma.visitor.findFirst({
      where: { email: user.email, tenantId: targetTenantId }
    });

    if (!visitor) {
      await prisma.visitor.create({
        data: { name: user.name, email: user.email, tenantId: targetTenantId }
      });
    }

    const { accessToken, refreshToken } = await generateTokens(user.id, user.email, user.role, targetTenantId, tenant.type);

    return res.json({
      accessToken,
      refreshToken,
      role: user.role,
      tenantId: targetTenantId,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: targetTenantId
      }
    });

  } catch (err) {
    console.error("Erro ao trocar de museu:", err);
    return res.status(500).json({ message: "Erro ao trocar de museu" });
  }
});

export default router;
