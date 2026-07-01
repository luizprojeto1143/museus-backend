import { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma.js";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on("finish", async () => {
    try {
      const durationMs = Date.now() - start;
      const statusCode = res.statusCode;
      const path = req.path;
      const method = req.method;

      // Filter: only log if status >= 400 OR slow request (>1500ms) OR webhook OR admin/municipal routes OR critical operations
      const isWebhook = path.includes("webhook");
      const isAdminOrMunicipal = path.startsWith("/admin") || path.startsWith("/municipal");
      const isSlow = durationMs > 1500;
      const isError = statusCode >= 400;

      if (isError || isSlow || isWebhook || isAdminOrMunicipal) {
        const tenantId = (req as any).tenantId || req.headers["x-tenant-id"] || null;
        const userId = req.user?.id || null;
        const ipAddress = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "");
        const userAgent = req.headers["user-agent"] || null;

        await prisma.apiRequestLog.create({
          data: {
            tenantId: typeof tenantId === "string" ? tenantId : null,
            userId,
            method,
            path,
            statusCode,
            durationMs,
            ipAddress,
            userAgent
          }
        });
      }
    } catch (error) {
      // Fail silently to avoid breaking the application response
      console.error("[ApiRequestLog Error] Failed to create request log:", error);
    }
  });

  next();
}
