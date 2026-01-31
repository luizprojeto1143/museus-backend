import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma.js";
import { Role } from "@prisma/client";
import { validate } from "../middleware/validate.js";
import { loginSchema, registerSchema, switchTenantSchema, registerTenantSchema } from "../schemas/auth.schema.js";
import { authMiddleware } from "../middleware/auth.js";
import { limiter } from "../middleware/rateLimiter.js";

const router = Router();

// SECURITY: JWT_SECRET must be set
// SECURITY: JWT_SECRET must be set
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error("FATAL: JWT_SECRET environment variable is not set in production!");
  } else {
    console.warn("WARNING: JWT_SECRET not set. Using temporary unsafe secret for development.");
  }
}
const JWT_SECRET = process.env.JWT_SECRET || "TEMP_DEV_SECRET_DO_NOT_USE_IN_PROD";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// Login
// Login
router.post("/login", limiter, validate(loginSchema), async (req, res) => {
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

    const token = jwt.sign(
      {
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        type: user.tenant?.type
      },
      JWT_SECRET as jwt.Secret,
      { subject: user.id, expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
    );

    return res.json({
      accessToken: token,
      role: user.role,
      tenantId: user.tenantId,
      tenantType: user.tenant?.type, // MUSEUM or PRODUCER
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

// Registro de visitante
// Registro de visitante
router.post("/register", limiter, validate(registerSchema), async (req, res) => {
  try {
    const { email, password, name, tenantId } = req.body;

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return res.status(400).json({ message: "Email já cadastrado" });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hash,
        name,
        role: Role.VISITOR,
        tenantId: tenantId || null
      }
    });

    const token = jwt.sign(
      {
        email: user.email,
        role: user.role,
        tenantId: user.tenantId
      },
      JWT_SECRET as jwt.Secret,
      { subject: user.id, expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
    );

    return res.status(201).json({
      accessToken: token,
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

// Registro de Novo Tenant (Produtor Cultural)
// Registro de Novo Tenant (Produtor Cultural) - DISABLED for Monetization Control
// router.post("/register-tenant", validate(registerTenantSchema), async (req, res) => {
//   return res.status(403).json({ message: "Registration disabled. Please contact sales." });
/*
try {
  const { email, password, name, projectName } = req.body;

  // 1. Verifica email
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    return res.status(400).json({ message: "Email já cadastrado" });
  }

  // 2. Gera Slug a partir do nome do projeto
  const slug = projectName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") + "-" + Math.floor(Math.random() * 1000);

  // 3. Hash Senha
  const hash = await bcrypt.hash(password, 10);

  // 4. Cria Tenant e Usuário Admin (Transaction idealmente, mas sequencial ok por enquanto)
  const tenant = await prisma.tenant.create({
    data: {
      name: projectName,
      slug: slug,
      plan: "TRIAL", // Começa como Trial
      featureWorks: true,
      featureTrails: true,
      featureEvents: true,
      featureQRCodes: true,
      featureAccessibility: false // Contratar depois
    }
  });

  const user = await prisma.user.create({
    data: {
      email,
      password: hash,
      name,
      role: Role.ADMIN, // É admin do próprio museu
      tenantId: tenant.id
    }
  });

  // 5. Gera Token
  const token = jwt.sign(
    {
      email: user.email,
      role: user.role,
      tenantId: user.tenantId
    },
    JWT_SECRET as jwt.Secret,
    { subject: user.id, expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
  );

  return res.status(201).json({
    accessToken: token,
    role: user.role,
    tenantId: user.tenantId,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId
    },
    tenantSlug: tenant.slug
  });

} catch (err) {
  console.error("Erro register-tenant", err);
  return res.status(500).json({ message: "Erro ao criar museu" });
}
*/
// });

// seed-master route removed for security audit compliance

// Rota para trocar de museu (tenant)
router.post("/switch-tenant", authMiddleware, validate(switchTenantSchema), async (req, res) => {
  try {
    const { targetTenantId } = req.body;
    const userId = req.user?.id;

    if (!targetTenantId || !userId) {
      return res.status(400).json({ message: "Tenant ID e User ID são obrigatórios" });
    }

    // Verificar se o tenant existe
    const tenant = await prisma.tenant.findUnique({ where: { id: targetTenantId } });
    if (!tenant) {
      return res.status(404).json({ message: "Museu não encontrado" });
    }

    // Buscar usuário
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    // Verificar se já existe perfil de visitante neste tenant
    let visitor = await prisma.visitor.findFirst({
      where: {
        email: user.email,
        tenantId: targetTenantId
      }
    });

    // Se não existir, criar
    if (!visitor) {
      visitor = await prisma.visitor.create({
        data: {
          name: user.name,
          email: user.email,
          tenantId: targetTenantId,
          // Copiar outros dados se necessário, ou deixar vazio
        }
      });
    }

    // Atualizar tenantId do usuário (contexto atual)
    await prisma.user.update({
      where: { id: userId },
      data: { tenantId: targetTenantId }
    });

    // Gerar novo token com o novo tenantId
    const newToken = jwt.sign(
      {
        email: user.email,
        role: user.role,
        tenantId: targetTenantId
      },
      JWT_SECRET as jwt.Secret,
      { subject: user.id, expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
    );

    return res.json({
      accessToken: newToken,
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
