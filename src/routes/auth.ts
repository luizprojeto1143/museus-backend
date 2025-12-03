import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma.js";
import { Role } from "@prisma/client";
import { validate } from "../middleware/validate.js";
import { loginSchema, registerSchema, switchTenantSchema } from "../schemas/auth.schema.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// Login
router.post("/login", validate(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
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
        tenantId: user.tenantId
      },
      JWT_SECRET as jwt.Secret,
      { subject: user.id, expiresIn: JWT_EXPIRES_IN as any }
    );

    return res.json({
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
    console.error("Erro login", err);
    return res.status(500).json({ message: "Erro ao autenticar" });
  }
});

// Registro de visitante
router.post("/register", validate(registerSchema), async (req, res) => {
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
      { subject: user.id, expiresIn: JWT_EXPIRES_IN as any }
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

// rota para seeding simples de MASTER (apenas dev)
router.post("/seed-master", async (req, res) => {
  try {
    const { email, password, name } = req.body as { email: string; password: string; name: string };
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return res.status(400).json({ message: "Já existe usuário com este email" });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hash,
        name,
        role: Role.MASTER
      }
    });
    return res.status(201).json({ id: user.id, email: user.email, role: user.role });
  } catch (err) {
    console.error("Erro seed-master", err);
    return res.status(500).json({ message: "Erro ao criar master" });
  }
});

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
      { subject: user.id, expiresIn: JWT_EXPIRES_IN as any }
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
