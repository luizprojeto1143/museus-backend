import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

const JWT_SECRET = process.env.JWT_SECRET || "secret";

interface JwtPayload {
  sub: string;
  role: Role;
  tenantId: string;
  email: string;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Não autenticado" });
  }

  const token = auth.substring(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = {
      id: payload.sub,
      role: payload.role,
      tenantId: payload.tenantId,
      email: payload.email
    };
    return next();
  } catch (err) {
    console.error("Erro JWT", err);
    return res.status(401).json({ message: "Token inválido" });
  }
}

export function requireRole(roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Não autenticado" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Sem permissão" });
    }
    return next();
  };
}
