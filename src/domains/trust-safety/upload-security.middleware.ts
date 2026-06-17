import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const storage = multer.memoryStorage(); // Na AWS, seria direto no S3 via aws-sdk + stream

export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter: (req, file, cb) => {
    // 1. Basic Extension/MIME check (SVG EXPLICITLY BLOCKED because it's not in ALLOWED_MIME_TYPES)
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não permitido por políticas de segurança.'));
    }
  }
});

export const secureUploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const uploader = upload.single('file');
  
  uploader(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      console.warn(`[Security Alert] Tentativa de upload bloqueada: ${err.message}`);
      return res.status(400).json({ error: err.message });
    } else if (err) {
      console.warn(`[Security Alert] Tentativa de upload inválida.`);
      return res.status(400).json({ error: err.message });
    }
    
    // Check magic bytes using file-type
    if (req.file && req.file.buffer) {
      try {
        const typeInfo = await fileTypeFromBuffer(req.file.buffer);
        if (!typeInfo || !ALLOWED_MIME_TYPES.includes(typeInfo.mime)) {
          console.warn(`[Security Alert] Mismatch de magic bytes ou arquivo não suportado.`);
          return res.status(400).json({ error: 'Conteúdo do arquivo inválido ou malicioso.' });
        }
      } catch (e) {
        return res.status(500).json({ error: 'Erro ao analisar o arquivo.' });
      }
    }
    
    // Sucesso, continua para o controller
    next();
  });
};
