import { prisma } from "../prisma.js";
import { SystemErrorSeverity, SystemErrorSource } from "@prisma/client";
import { sanitizeLogMetadata } from "../utils/sanitize.js";

interface SystemErrorPayload {
  tenantId?: string | null;
  userId?: string | null;
  source?: SystemErrorSource;
  severity?: SystemErrorSeverity;
  message: string;
  stack?: string | null;
  path?: string | null;
  method?: string | null;
  statusCode?: number | null;
  metadata?: any;
}

export async function createSystemError(payload: SystemErrorPayload) {
  try {
    const sanitizedMetadata = sanitizeLogMetadata(payload.metadata);

    return await prisma.systemErrorLog.create({
      data: {
        tenantId: payload.tenantId || null,
        userId: payload.userId || null,
        source: payload.source || SystemErrorSource.BACKEND,
        severity: payload.severity || SystemErrorSeverity.MEDIUM,
        message: payload.message,
        stack: payload.stack || null,
        path: payload.path || null,
        method: payload.method || null,
        statusCode: payload.statusCode || null,
        metadata: sanitizedMetadata || null
      }
    });
  } catch (error) {
    console.error("[SystemErrorLog Error] Failed to write error log:", error);
  }
}
