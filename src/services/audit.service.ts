import { prisma } from "../prisma.js";
import { AuditAction } from "@prisma/client";
import { sanitizeLogMetadata } from "../utils/sanitize.js";

interface AuditLogPayload {
  tenantId?: string | null;
  userId?: string | null;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: any;
}

export async function createAuditLog(payload: AuditLogPayload) {
  try {
    const sanitizedMetadata = sanitizeLogMetadata(payload.metadata);

    return await prisma.auditLog.create({
      data: {
        tenantId: payload.tenantId || null,
        userId: payload.userId || null,
        action: payload.action,
        entityType: payload.entityType || null,
        entityId: payload.entityId || null,
        ipAddress: payload.ipAddress || null,
        userAgent: payload.userAgent || null,
        metadata: sanitizedMetadata || null
      }
    });
  } catch (error) {
    console.error("[AuditLog Error] Failed to write audit log:", error);
  }
}
