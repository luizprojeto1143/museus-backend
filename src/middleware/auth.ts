import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

// SECURITY: JWT_SECRET must be set in production. In dev, we warn if missing.
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error("FATAL: JWT_SECRET environment variable is not set in production!");
  } else {
    console.warn("WARNING: JWT_SECRET not set. Using temporary unsafe secret for development.");
  }
}
const JWT_SECRET = process.env.JWT_SECRET || "TEMP_DEV_SECRET_DO_NOT_USE_IN_PROD";

interface JwtPayload {
  sub: string;
  role: Role;
  tenantId: string;
  email: string;
  name?: string;
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
      email: payload.email,
      name: payload.name
    };
    return next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      console.warn("⚠️ Token Expirado:", { sub: (jwt.decode(token) as any)?.sub, expiredAt: err.expiredAt });
    } else {
      console.error("❌ Erro JWT Verificação:", err instanceof Error ? err.message : err);
    }
    return res.status(401).json({ 
      message: err instanceof jwt.TokenExpiredError ? "Sessão expirada" : "Token inválido"
    });
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


export function softAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return next();
  }

  const token = auth.substring(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = {
      id: payload.sub,
      role: payload.role,
      tenantId: payload.tenantId,
      email: payload.email,
      name: payload.name
    };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      // Opt-out logging for soft-auth expired tokens if they are too frequent
    } else {
      console.log("ℹ️ Soft-auth hint: Token inválido ou malformado ignorado.");
    }
  }
  return next();
}
