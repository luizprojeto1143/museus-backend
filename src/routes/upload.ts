import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { uploadLimiter } from "../middleware/rateLimiter.js";
import { prisma } from "../prisma.js";
import { Role } from "@prisma/client";
import https from "https";
import http from "http";
import { MediaService } from "../services/mediaService.js";

const router = Router();

const uploadDir = process.env.UPLOAD_DIR || "uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Log storage mode on startup
const r2Required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_PUBLIC_BASE_URL"];
const r2Missing = r2Required.filter(v => !process.env[v]);

if (r2Missing.length === 0) {
  console.log("✅ [Upload] Storage mode: Cloudflare R2");
} else if (r2Missing.length === r2Required.length) {
  console.log("⚠️ [Upload] Storage mode: Local (ephemeral storage! Files will disappear after restart)");
} else {
  console.error(`❌ [Upload] R2 Configuration Incomplete! Missing: ${r2Missing.join(", ")}`);
  console.error("   Falling back to Local storage (ephemeral!)");
}

const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => cb(null, uploadDir),
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const safe = base.replace(/[^a-zA-Z0-9_-]/g, "_");
    cb(null, `${Date.now()}_${safe}${ext}`);
  }
});

// TYPES
const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm'],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
  documents: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_DOC_SIZE = 10 * 1024 * 1024; // 10MB

function createFileFilter(category: string) {
  return (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedTypes = ALLOWED_MIME_TYPES[category] || [];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de arquivo não permitido. Tipos aceitos: ${allowedTypes.join(', ')}`));
    }
  };
}

const uploadImage = multer({ storage, fileFilter: createFileFilter('images'), limits: { fileSize: MAX_IMAGE_SIZE } });
const uploadAudio = multer({ storage, fileFilter: createFileFilter('audio'), limits: { fileSize: MAX_VIDEO_SIZE } });
const uploadVideo = multer({ storage, fileFilter: createFileFilter('video'), limits: { fileSize: MAX_VIDEO_SIZE } });
const uploadDocument = multer({ storage, fileFilter: createFileFilter('documents'), limits: { fileSize: MAX_DOC_SIZE } });

// R2 HELPERS
function hasR2Config() {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME && process.env.R2_PUBLIC_BASE_URL);
}

function createR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID!;
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!
    }
  });
}

// UPLOAD HANDLER
async function handleUpload(req: Request, res: Response, type: string) {
  const file = req.file;
  const user = req.user!;

  if (!file) return res.status(400).json({ message: "Arquivo é obrigatório" });
  if (!user.tenantId) return res.status(400).json({ message: "TenantId não identificado" });

  try {
    // 0. Compression
    if (type === "image") {
      await MediaService.compressImage(file.path);
    } 
    /* 
    // [DISABLED] Compression disabled to avoid timeouts on Render (512MB)
    else if (type === "video") {
      const newPath = await MediaService.compressVideo(file.path);
      if (newPath !== file.path) {
        file.path = newPath;
        file.filename = path.basename(newPath);
        file.mimetype = "video/mp4";
      }
    } else if (type === "audio") {
      const newPath = await MediaService.compressAudio(file.path);
      if (newPath !== file.path) {
        file.path = newPath;
        file.filename = path.basename(newPath);
        file.mimetype = "audio/mpeg";
      }
    }
    */

    // Refresh file stats for accurate metadata in DB
    const stats = fs.statSync(file.path);
    const fileSize = stats.size;

    let url = "";

    // 1. Upload to Storage
    if (hasR2Config()) {
      const client = createR2Client();
      const bucket = process.env.R2_BUCKET_NAME!;
      const publicBase = process.env.R2_PUBLIC_BASE_URL!;
      const fileContent = fs.readFileSync(file.path);
      const key = `${type}/${file.filename}`;

      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fileContent,
        ContentType: file.mimetype
      }));

      fs.unlinkSync(file.path); // Remove temp
      url = `${publicBase.replace(/\/$/, "")}/${key}`;
    } else {
      // C5: Block upload if R2 is not configured to prevent data loss on ephemeral storage
      if (process.env.NODE_ENV === "production") {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          return res.status(503).json({ 
              message: "Armazenamento não configurado. Upload desabilitado para evitar perda de dados." 
          });
      }
      url = `/uploads/${file.filename}`;
    }

    // 2. Persist Metadata in DB (CRITICAL FIX FOR IDOR)
    const fileRecord = await prisma.file.create({
      data: {
        filename: file.filename,
        originalName: file.originalname,
        url,
        type,
        mimeType: file.mimetype,
        size: fileSize,
        tenantId: user.tenantId,
        uploadedBy: user.id
      }
    });

    return res.json(fileRecord);
  } catch (err) {
    console.error("Erro upload", err);
    // Try cleanup temp file if exists
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    return res.status(500).json({ message: "Erro ao processar upload", error: String(err) });
  }
}

// ROUTES
router.post("/image",    authMiddleware, uploadLimiter, uploadImage.single("file"),    (req, res) => handleUpload(req, res, "image"));
router.post("/audio",    authMiddleware, uploadLimiter, uploadAudio.single("file"),    (req, res) => handleUpload(req, res, "audio"));
router.post("/video",    authMiddleware, uploadLimiter, uploadVideo.single("file"),    (req, res) => handleUpload(req, res, "video"));
router.post("/document", authMiddleware, uploadLimiter, uploadDocument.single("file"), (req, res) => handleUpload(req, res, "document"));

// Generic upload (used by AdminUploads.tsx – validates MIME server-side)
router.post("/", authMiddleware, uploadLimiter, uploadImage.single("file"), async (req, res) => {
  // Try all categories
  const file = req.file;
  if (!file) return res.status(400).json({ message: "Arquivo é obrigatório" });
  const allAllowed = Object.values(ALLOWED_MIME_TYPES).flat();
  if (!allAllowed.includes(file.mimetype)) {
    if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    return res.status(400).json({ message: `Tipo não permitido: ${file.mimetype}` });
  }
  const type = file.mimetype.startsWith("image") ? "image"
    : file.mimetype.startsWith("audio") ? "audio"
    : file.mimetype.startsWith("video") ? "video"
    : "document";
  return handleUpload(req, res, type);
});

// LIST FILES (SECURE)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    const { tenantId, type } = req.query;

    // Security check: Only allow listing files for your own tenant
    const targetTenantId = (user.role === Role.MASTER && tenantId) ? String(tenantId) : user.tenantId;

    if (!targetTenantId) return res.status(400).json({ message: "Tenant obrigatório" });

    const files = await prisma.file.findMany({
      where: {
        tenantId: targetTenantId,
        ...(type ? { type: String(type) } : {})
      },
      orderBy: { createdAt: "desc" }
    });

    return res.json(files);
  } catch (err) {
    console.error("Erro listar arquivos", err);
    return res.status(500).json({ message: "Erro ao listar arquivos" });
  }
});

// UPDATE FILE METADATA (e.g. useInAi)
router.patch("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { useInAi } = req.body;
    const user = req.user!;

    const file = await prisma.file.findUnique({ where: { id } });

    if (!file) return res.status(404).json({ message: "Arquivo não encontrado" });

    // SECURITY: Ensure ownership
    if (user.role !== Role.MASTER && file.tenantId !== user.tenantId) {
      return res.status(403).json({ message: "Sem permissão para editar este arquivo" });
    }

    const updated = await prisma.file.update({
      where: { id },
      data: {
        useInAi: useInAi !== undefined ? Boolean(useInAi) : undefined
      }
    });

    return res.json(updated);
  } catch (err) {
    console.error("Erro atualizar arquivo", err);
    return res.status(500).json({ message: "Erro ao atualizar arquivo" });
  }
});

// DELETE FILE (SECURE IDOR FIX)
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const file = await prisma.file.findUnique({ where: { id } });

    if (!file) return res.status(404).json({ message: "Arquivo não encontrado" });

    // SECURITY: Ensure ownership
    if (user.role !== Role.MASTER && file.tenantId !== user.tenantId) {
      return res.status(403).json({ message: "Sem permissão para excluir este arquivo" });
    }

    // 1. Delete from DB
    await prisma.file.delete({ where: { id } });

    // 2. Delete from Storage (Async, best effort)
    deleteFromStorage(file.url).catch(console.error);

    return res.json({ message: "Arquivo excluído" });
  } catch (err) {
    console.error("Erro excluir arquivo", err);
    return res.status(500).json({ message: "Erro ao excluir arquivo" });
  }
});

// Helper to delete from storage (Local or R2)
export async function deleteFromStorage(fileUrl: string) {
  if (!fileUrl) return;

  try {
    const publicBase = process.env.R2_PUBLIC_BASE_URL;

    // R2 Delete
    if (publicBase && fileUrl.startsWith(publicBase)) {
      if (!hasR2Config()) return;
      const bucket = process.env.R2_BUCKET_NAME!;
      const key = fileUrl.replace(`${publicBase}/`, "");
      const cleanKey = key.startsWith('/') ? key.substring(1) : key;
      const client = createR2Client();
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: cleanKey }));
      console.log(`[Storage] Deleted from R2: ${cleanKey}`);
    }
    // Local Delete
    else if (fileUrl.includes("/uploads/")) {
      const rawFilename = fileUrl.split("/uploads/").pop();
      if (rawFilename) {
        // SECURITY: Prevent path traversal by extracting only the base name
        const filename = path.basename(rawFilename);
        const filepath = path.join(uploadDir, filename);
        
        // Ensure the resolved path actually stays inside uploadDir
        const resolvedUploadDir = path.resolve(uploadDir);
        const resolvedFilePath = path.resolve(filepath);
        
        if (resolvedFilePath.startsWith(resolvedUploadDir) && fs.existsSync(resolvedFilePath)) {
          fs.unlinkSync(resolvedFilePath);
          console.log(`[Storage] Deleted local file: ${resolvedFilePath}`);
        }
      }
    }
  } catch (err) {
    console.warn(`[Storage] Failed to delete file ${fileUrl}`, err);
  }
}

// PROXY IMAGE (FOR CORS)
router.get("/proxy", async (req, res) => {
  try {
    const imageUrl = req.query.url as string;
    if (!imageUrl) return res.status(400).send("URL is required");

    // SSRF Protection: Allowlist specific domains
    const allowedDomains = ["images.unsplash.com", "firebasestorage.googleapis.com", "s3.amazonaws.com"];
    try {
        const urlObj = new URL(imageUrl);
        if (!allowedDomains.includes(urlObj.hostname)) {
            return res.status(403).send("Forbidden: Unrecognized image source");
        }
    } catch(e) {
        return res.status(400).send("Invalid URL");
    }

    // Fetch the image from the external URL using https or http
    const httpModule = imageUrl.startsWith("https") ? https : http;

    httpModule.get(imageUrl, (response) => {
      // Forward the content-type from the external response
      if (response.headers['content-type']) {
        res.setHeader('Content-Type', response.headers['content-type']);
      }
      
      // Forward caching headers to optimize proxy
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours

      // Pipe the external image stream directly to our response
      response.pipe(res);
    }).on('error', (err) => {
      console.error("Erro no proxy de imagem:", err);
      res.status(500).send("Error fetching image");
    });
  } catch (err) {
    console.error("Erro no proxy de imagem (try/catch):", err);
    res.status(500).send("Error fetching image");
  }
});

export default router;


