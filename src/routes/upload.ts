import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

const uploadDir = process.env.UPLOAD_DIR || "uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
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

// SECURITY: Allowed file types per category
const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm'],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']
};

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

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

const uploadImage = multer({
  storage,
  fileFilter: createFileFilter('images'),
  limits: { fileSize: MAX_FILE_SIZE }
});

const uploadAudio = multer({
  storage,
  fileFilter: createFileFilter('audio'),
  limits: { fileSize: MAX_FILE_SIZE }
});

const uploadVideo = multer({
  storage,
  fileFilter: createFileFilter('video'),
  limits: { fileSize: MAX_FILE_SIZE }
});

const upload = multer({ storage });

function hasR2Config() {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME &&
    process.env.R2_PUBLIC_BASE_URL
  );
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

async function uploadToR2(file: Express.Multer.File, folder: string) {
  const client = createR2Client();
  const bucket = process.env.R2_BUCKET_NAME!;
  const publicBase = process.env.R2_PUBLIC_BASE_URL!;
  const fileContent = fs.readFileSync(file.path);
  const key = `${folder}/${file.filename}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileContent,
      ContentType: file.mimetype
    })
  );

  // remove local temp
  fs.unlinkSync(file.path);

  return `${publicBase.replace(/\/$/, "")}/${key}`;
}

async function handleUpload(req: Request, res: Response, folder: string) {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: "Arquivo é obrigatório" });
  }

  try {
    if (hasR2Config()) {
      const url = await uploadToR2(file, folder);
      return res.json({ url });
    } else {
      const url = `/uploads/${file.filename}`;
      return res.json({ url });
    }
  } catch (err) {
    console.error("Erro upload", err);
    return res.status(500).json({ message: "Erro ao fazer upload" });
  }
}

// SECURITY: All upload routes now require authentication and validate file types
router.post("/image", authMiddleware, uploadImage.single("file"), (req: Request, res: Response) => {
  return handleUpload(req, res, "images");
});

router.post("/audio", authMiddleware, uploadAudio.single("file"), (req: Request, res: Response) => {
  return handleUpload(req, res, "audio");
});

router.post("/video", authMiddleware, uploadVideo.single("file"), (req: Request, res: Response) => {
  return handleUpload(req, res, "video");
});

// Listar arquivos (apenas local por enquanto, R2 precisaria de outra lógica)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { tenantId } = req.query;
    // Como não salvamos metadados dos arquivos no banco, vamos listar do diretório local
    // Isso é limitado e não funcionará bem com R2 ou múltiplos tenants isolados por pasta
    // TODO: Criar tabela 'File' no banco para gerenciar uploads corretamente

    if (!fs.existsSync(uploadDir)) {
      return res.json([]);
    }

    const files = fs.readdirSync(uploadDir).map(file => {
      const stats = fs.statSync(path.join(uploadDir, file));
      return {
        id: file,
        filename: file,
        url: `/uploads/${file}`,
        type: file.endsWith(".jpg") || file.endsWith(".png") ? "image" : "file",
        size: stats.size,
        uploadedAt: stats.birthtime,
        usedIn: []
      };
    });

    return res.json(files);
  } catch (err) {
    console.error("Erro listar uploads", err);
    return res.status(500).json({ message: "Erro ao listar arquivos" });
  }
});

router.delete("/:filename", authMiddleware, async (req, res) => {
  try {
    const { filename } = req.params;

    // SECURITY: Sanitize filename to prevent path traversal
    const sanitizedFilename = path.basename(filename);
    if (sanitizedFilename !== filename || filename.includes('..')) {
      return res.status(400).json({ message: "Nome de arquivo inválido" });
    }

    const filepath = path.join(uploadDir, sanitizedFilename);

    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      return res.json({ message: "Arquivo excluído" });
    }

    return res.status(404).json({ message: "Arquivo não encontrado" });
  } catch (err) {
    console.error("Erro excluir upload", err);
    return res.status(500).json({ message: "Erro ao excluir arquivo" });
  }
});

// Helper to delete from storage (Local or R2)
export async function deleteFromStorage(fileUrl: string) {
  if (!fileUrl) return;

  try {
    // 1. Check if it's an R2 URL
    const publicBase = process.env.R2_PUBLIC_BASE_URL;
    if (publicBase && fileUrl.startsWith(publicBase)) {
      if (!hasR2Config()) return;

      const bucket = process.env.R2_BUCKET_NAME!;
      const key = fileUrl.replace(`${publicBase}/`, "");

      // Clean up leading slash if present (rare)
      const cleanKey = key.startsWith('/') ? key.substring(1) : key;

      const client = createR2Client();
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: cleanKey
        })
      );
      console.log(`[Storage] Deleted from R2: ${cleanKey}`);
      return;
    }

    // 2. Local File (fallback)
    // URL format: /uploads/filename.ext or http://domain/uploads/filename.ext
    const filename = fileUrl.split("/uploads/").pop();
    if (filename) {
      const filepath = path.join(uploadDir, filename);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        console.log(`[Storage] Deleted local file: ${filepath}`);
      }
    }
  } catch (err) {
    console.warn(`[Storage] Failed to delete file ${fileUrl}`, err);
  }
}

export default router;

