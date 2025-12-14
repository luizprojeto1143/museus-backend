import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import bcrypt from "bcrypt";

const router = Router();

router.get("/", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
  try {
    const user = req.user!;
    let whereClause: any = {};

    if (user.role === Role.ADMIN) {
      if (!user.tenantId) {
        return res.status(403).json({ message: "Admin sem tenantId" });
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
        tenant: {
          select: {
            name: true,
            slug: true
          }
        },
        createdAt: true,
        active: true,
        lastLogin: true
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
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        tenant: {
          select: {
            name: true,
            slug: true
          }
        },
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    return res.json(user);
  } catch (err) {
    console.error("Erro ao buscar usuário", err);
    return res.status(500).json({ message: "Erro ao buscar usuário" });
  }
});

router.post("/", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    const { email, password, name, role, tenantId } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      role?: string;
      tenantId?: string;
    };

    if (!email || !password || !name || !role) {
      return res.status(400).json({ message: "email, password, name e role são obrigatórios" });
    }

    if (!["MASTER", "ADMIN", "VISITOR"].includes(role)) {
      return res.status(400).json({ message: "role deve ser MASTER, ADMIN ou VISITOR" });
    }

    if (role === "ADMIN" && !tenantId) {
      return res.status(400).json({ message: "tenantId é obrigatório para role ADMIN" });
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
        tenantId: tenantId || null
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        createdAt: true
      }
    });

    return res.status(201).json(user);
  } catch (err) {
    console.error("Erro ao criar usuário", err);
    return res.status(500).json({ message: "Erro ao criar usuário" });
  }
});

router.put("/:id", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const { email, name, role, tenantId, password } = req.body as {
      email?: string;
      name?: string;
      role?: string;
      tenantId?: string;
      password?: string;
    };

    interface UserUpdateData {
      email?: string;
      name?: string;
      role?: Role;
      tenantId?: string | null;
      password?: string;
    }

    const data: UserUpdateData = {};

    if (email) data.email = email;
    if (name) data.name = name;
    if (role) data.role = role as Role;
    if (tenantId !== undefined) data.tenantId = tenantId || null;
    if (password) data.password = await bcrypt.hash(password, 10);

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        updatedAt: true
      }
    });

    return res.json(user);
  } catch (err) {
    console.error("Erro ao atualizar usuário", err);
    return res.status(500).json({ message: "Erro ao atualizar usuário" });
  }
});

router.delete("/:id", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.user.delete({ where: { id } });
    return res.json({ message: "Usuário excluído com sucesso" });
  } catch (err) {
    console.error("Erro ao excluir usuário", err);
    return res.status(500).json({ message: "Erro ao excluir usuário" });
  }
});

export default router;
