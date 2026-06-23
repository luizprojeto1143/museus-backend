import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { prisma } from "../prisma.js";

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
  permissions?: any;
}

function getCookie(cookies: string | undefined, name: string) {
  if (!cookies) return null;
  const match = cookies.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  let token: string | null = null;
  
  // 1. Try Authorization header
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    token = auth.substring(7);
  } 
  
  // 2. Try Cookie if header is missing (for production excellence)
  if (!token) {
    token = getCookie(req.headers.cookie, "museus_token");
  }

  if (!token) {
    console.warn(`[AUTH] Missing authentication from ${req.ip}`);
    return res.status(401).json({ message: "Não autenticado" });
  }

  try {
    // 3. Security: Check if token is in Blacklist
    const blacklisted = await prisma.tokenBlacklist.findUnique({
      where: { token }
    });
    
    if (blacklisted) {
      console.warn(`[AUTH] Attempt to use revoked token from ${req.ip}`);
      return res.status(401).json({ message: "Sessão inválida ou revogada" });
    }

    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = {
      id: payload.sub,
      role: payload.role,
      tenantId: payload.tenantId,
      email: payload.email,
      name: payload.name,
      permissions: payload.permissions
    };
    
    // Resolve tenantId considering MASTER overrides
    if (payload.role === 'MASTER') {
      const headerTenant = req.headers["x-tenant-id"];
      const queryTenant = req.query.tenantId;
      const bodyTenant = req.body?.tenantId;
      const override = headerTenant || queryTenant || bodyTenant;

      if (override && override !== "undefined" && override !== "null" && override !== "") {
        (req as any).tenantId = String(override);
      } else if (payload.tenantId) {
        (req as any).tenantId = payload.tenantId;
      }
    } else if (payload.tenantId) {
      (req as any).tenantId = payload.tenantId;
    }

    return next();
  } catch (err) {
    const tokenData = jwt.decode(token) as any;
    if (err instanceof jwt.TokenExpiredError) {
      console.warn(`[AUTH] Token Expired: sub=${tokenData?.sub}, email=${tokenData?.email}, expiredAt=${err.expiredAt}`);
      return res.status(401).json({ message: "Sessão expirada", code: "TOKEN_EXPIRED" });
    } else {
      console.error(`[AUTH] JWT Verification Failed: ${err instanceof Error ? err.message : err}. Token sub: ${tokenData?.sub}`);
      return res.status(401).json({ message: "Token inválido", code: "INVALID_TOKEN" });
    }
  }
}

export function requireRole(roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Não autenticado" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Sem permissão (Role)" });
    }
    return next();
  };
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Não autenticado" });
    }
    
    // Master and Admin have bypass
    if (req.user.role === Role.MASTER || req.user.role === Role.ADMIN) {
      return next();
    }

    // Operational roles check flags (Collaborator, Producer, etc)
    if (([Role.COLLABORATOR, Role.PRODUCER] as Role[]).includes(req.user.role) && req.user.permissions?.[permission]) {
      return next();
    }

    return res.status(403).json({ message: `Sem permissão: ${permission}` });
  };
}

export function softAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  let token: string | null = null;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    token = auth.substring(7);
  } else {
    token = getCookie(req.headers.cookie, "museus_token");
  }

  if (!token) {
    return next();
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = {
      id: payload.sub,
      role: payload.role,
      tenantId: payload.tenantId,
      email: payload.email,
      name: payload.name,
      permissions: payload.permissions
    };

    if (payload.tenantId) {
      (req as any).tenantId = payload.tenantId;
    }
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      // Opt-out logging for soft-auth expired tokens if they are too frequent
    } else {
      console.log("ℹ️ Soft-auth hint: Token inválido ou malformado ignorado.");
    }
  }
  return next();
}
