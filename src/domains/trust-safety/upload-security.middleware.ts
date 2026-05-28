import { Request, Response, NextFunction } from 'express';
import multer from 'multer';

// Em um ambiente real de hiperescala, usaríamos bibliotecas que leem os magic bytes do arquivo
// como o 'file-type' para garantir que um arquivo .php não foi renomeado para .jpg
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const storage = multer.memoryStorage(); // Na AWS, seria direto no S3 via aws-sdk + stream

export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter: (req, file, cb) => {
    // 1. Basic Extension/MIME check
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não permitido por políticas de segurança.'));
    }
  }
});

export const secureUploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const uploader = upload.single('file');
  
  uploader(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      // Ex: file too large
      console.warn(`[Security Alert] Tentativa de upload bloqueada: ${err.message}`);
      return res.status(400).json({ error: err.message });
    } else if (err) {
      console.warn(`[Security Alert] Tentativa de upload inválida.`);
      return res.status(400).json({ error: err.message });
    }
    
    // Sucesso, continua para o controller
    next();
  });
};
