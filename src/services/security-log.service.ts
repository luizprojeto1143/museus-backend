import { prisma } from "../prisma.js";
import { SecurityEventType, SecurityEventSeverity } from "@prisma/client";
import { sanitizeLogMetadata } from "../utils/sanitize.js";

interface SecurityEventPayload {
  tenantId?: string | null;
  userId?: string | null;
  type: SecurityEventType;
  severity?: SecurityEventSeverity;
  ipAddress?: string | null;
  userAgent?: string | null;
  path?: string | null;
  method?: string | null;
  metadata?: any;
}

export async function createSecurityEvent(payload: SecurityEventPayload) {
  try {
    const sanitizedMetadata = sanitizeLogMetadata(payload.metadata);

    return await prisma.securityEventLog.create({
      data: {
        tenantId: payload.tenantId || null,
        userId: payload.userId || null,
        type: payload.type,
        severity: payload.severity || SecurityEventSeverity.WARNING,
        ipAddress: payload.ipAddress || null,
        userAgent: payload.userAgent || null,
        path: payload.path || null,
        method: payload.method || null,
        metadata: sanitizedMetadata || null
      }
    });
  } catch (error) {
    console.error("[SecurityEventLog Error] Failed to write security event:", error);
  }
}
