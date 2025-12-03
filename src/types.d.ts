import type { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface UserPayload {
      id: string;
      role: Role;
      tenantId?: string | null;
      email: string;
    }
    interface Request {
      user?: UserPayload;
    }
  }
}

export {};
