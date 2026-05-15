import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createUserSchema, updateUserSchema } from "../schemas/user.schema.js";
import { Role } from "@prisma/client";
import bcrypt from "bcrypt";
import { createAuditLog } from "./audit.js";

const router = Router();

router.get("/", authMiddleware, requireRole([Role.MASTER, Role.ADMIN, Role.COLLABORATOR]), async (req, res) => {
  try {
    const user = req.user!;
    const whereClause: Record<string, string> = {};

    if (user.role !== Role.MASTER) {
      if (!user.tenantId) {
        return res.status(403).json({ message: "Usuário sem tenantId" });
      }
      whereClause.tenantId = user.tenantId;
    } else if (req.query.tenantId) {
      whereClause.tenantId = req.query.tenantId as string;
    }

    const users = await prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        permissions: true,
        tenant: {
          select: {
            name: true,
            slug: true
          }
        },
        createdAt: true,
        active: true,
        lastLogin: true,
        termsAcceptedAt: true,
        termsAcceptedIp: true
      },
      orderBy: { createdAt: "desc" }
    });

    return res.json(users);
  } catch (err) {
    console.error("Erro ao listar usuários", err);
    return res.status(500).json({ message: "Erro ao listar usuários" });
  }
});

router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const currentUser = req.user!;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        permissions: true,
        tenant: {
          select: {
            name: true,
            slug: true
          }
        },
        createdAt: true,
        updatedAt: true,
        termsAcceptedAt: true,
        termsAcceptedIp: true
      }
    });

    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    // SECURITY: Admin users can only view users from their own tenant
    if (currentUser.role === Role.ADMIN && user.tenantId !== currentUser.tenantId) {
      return res.status(403).json({ message: "Sem permissão para acessar este usuário" });
    }

    return res.json(user);
  } catch (err) {
    console.error("Erro ao buscar usuário", err);
    return res.status(500).json({ message: "Erro ao buscar usuário" });
  }
});

router.post("/", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), validate(createUserSchema), async (req, res) => {
  try {
    const { email, password, name, role, tenantId, permissions } = req.body;
    const currentUser = req.user!;

    // SECURITY: ADMIN can only create COLLABORATOR or PRODUCER roles for their own tenant
    if (currentUser.role === Role.ADMIN) {
      if (!([Role.COLLABORATOR, Role.PRODUCER] as Role[]).includes(role as Role)) {
        return res.status(403).json({ message: "Administradores só podem criar colaboradores ou produtores" });
      }
      if (tenantId && tenantId !== currentUser.tenantId) {
        return res.status(403).json({ message: "Administradores só podem criar usuários para o seu próprio museu" });
      }
    }

    // Sanitise permissions (ensure admin doesn't grant master flags)
    const allowedFlags = ["manage_works", "manage_events", "manage_trails", "view_analytics", "manage_scanner", "manage_chat_ai", "manage_guestbook", "manage_shop", "manage_gamification", "manage_institutional", "manage_operations", "manage_marketing", "manage_roadmap"];
    const sanitizedPermissions: any = {};
    if (permissions && typeof permissions === 'object') {
      Object.keys(permissions).forEach(key => {
        if (allowedFlags.includes(key)) {
          sanitizedPermissions[key] = !!permissions[key];
        }
      });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ message: "Email já cadastrado" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: role as Role,
        tenantId: (currentUser.role === Role.ADMIN ? currentUser.tenantId : tenantId) || null,
        permissions: sanitizedPermissions
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        permissions: true,
        createdAt: true
      }
    });

    await createAuditLog(
      'CREATE',
      'User',
      user.id,
      req.user!.id,
      req.user!.email,
      user.tenantId || req.user!.tenantId || 'master',
      null,
      user,
      req
    );

    return res.status(201).json(user);
  } catch (err) {
    console.error("Erro ao criar usuário", err);
    return res.status(500).json({ message: "Erro ao criar usuário" });
  }
});

router.put("/me/settings", authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    const { preferences, bio, phone, website } = req.body;

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        preferences: preferences !== undefined ? preferences : undefined,
        bio: bio !== undefined ? bio : undefined,
        phone: phone !== undefined ? phone : undefined,
        website: website !== undefined ? website : undefined
      },
      select: { id: true, name: true, email: true, preferences: true, bio: true, phone: true, website: true }
    });

    return res.json(updated);
  } catch (err) {
    console.error("Erro atualizar settings", err);
    return res.status(500).json({ message: "Erro ao salvar configurações" });
  }
});

router.put("/:id", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), validate(updateUserSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { email, name, role, tenantId, password, permissions } = req.body;
    const currentUser = req.user!;

    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    // SECURITY: ADMIN can only update COLLABORATOR or PRODUCER users from their own tenant
    if (currentUser.role === Role.ADMIN) {
      if (targetUser.tenantId !== currentUser.tenantId) {
        return res.status(403).json({ message: "Sem permissão para editar usuários de outros museus" });
      }
      if (!([Role.COLLABORATOR, Role.PRODUCER] as Role[]).includes(targetUser.role as Role)) {
         return res.status(403).json({ message: "Administradores só podem editar colaboradores ou produtores" });
      }
    }

    // Sanitise permissions
    const allowedFlags = ["manage_works", "manage_events", "manage_trails", "view_analytics", "manage_scanner", "manage_chat_ai", "manage_guestbook", "manage_shop", "manage_gamification", "manage_institutional", "manage_operations", "manage_marketing", "manage_roadmap"];
    const sanitizedPermissions: any = {};
    if (permissions !== undefined && typeof permissions === 'object') {
      Object.keys(permissions).forEach(key => {
        if (allowedFlags.includes(key)) {
          sanitizedPermissions[key] = !!permissions[key];
        }
      });
    }

    interface UserUpdateData {
      email?: string;
      name?: string;
      role?: Role;
      tenantId?: string | null;
      password?: string;
      permissions?: any;
    }

    const data: UserUpdateData = {};

    if (email) data.email = email;
    if (name) data.name = name;
    if (role && currentUser.role === Role.MASTER) data.role = role as Role;
    if (tenantId !== undefined && currentUser.role === Role.MASTER) data.tenantId = tenantId || null;
    if (password) data.password = await bcrypt.hash(password, 10);
    if (permissions !== undefined) data.permissions = sanitizedPermissions;

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        permissions: true,
        updatedAt: true
      }
    });

    await createAuditLog(
      'UPDATE',
      'User',
      id,
      req.user!.id,
      req.user!.email,
      user.tenantId || req.user!.tenantId || 'master',
      targetUser,
      user,
      req
    );

    return res.json(user);
  } catch (err) {
    console.error("Erro ao atualizar usuário", err);
    return res.status(500).json({ message: "Erro ao atualizar usuário" });
  }
});

router.delete("/:id", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
  try {
    const { id } = req.params;
    const currentUser = req.user!;
    
    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    // SECURITY: ADMIN can only delete COLLABORATOR users from their own tenant
    if (currentUser.role === Role.ADMIN) {
      if (targetUser.tenantId !== currentUser.tenantId) {
        return res.status(403).json({ message: "Sem permissão para excluir usuários de outros tenants" });
      }
      if (targetUser.role !== Role.COLLABORATOR) {
        return res.status(403).json({ message: "Administradores só podem excluir colaboradores" });
      }
    }

    await prisma.user.delete({ where: { id } });

    await createAuditLog(
      'DELETE',
      'User',
      id,
      req.user!.id,
      req.user!.email,
      targetUser?.tenantId || req.user!.tenantId || 'master',
      targetUser,
      null,
      req
    );

    return res.json({ message: "Usuário excluído com sucesso" });
  } catch (err) {
    console.error("Erro ao excluir usuário", err);
    return res.status(500).json({ message: "Erro ao excluir usuário" });
  }
});

export default router;
