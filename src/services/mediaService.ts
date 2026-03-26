import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const unlink = promisify(fs.unlink);
const rename = promisify(fs.rename);

export class MediaService {
  /**
   * Comprime uma imagem e substitui o arquivo original
   */
  static async compressImage(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    const tempPath = `${filePath}_temp${ext}`;
    
    try {
      let pipeline = sharp(filePath);
      const metadata = await pipeline.metadata();

      // Redimensiona se for maior que 1920px de largura
      const maxWidth = parseInt(process.env.MAX_IMAGE_WIDTH || '1920');
      if (metadata.width && metadata.width > maxWidth) {
        pipeline = pipeline.resize(maxWidth);
      }

      const quality = parseInt(process.env.COMPRESSION_QUALITY || '80');

      // Mantém o formato original mas aplica compressão
      if (ext === '.jpg' || ext === '.jpeg') {
        await pipeline.jpeg({ quality, progressive: true }).toFile(tempPath);
      } else if (ext === '.png') {
        await pipeline.png({ quality: Math.min(quality, 90), compressionLevel: 9 }).toFile(tempPath);
      } else if (ext === '.webp') {
        await pipeline.webp({ quality }).toFile(tempPath);
      } else {
        // Para outros formatos (gif, svg), apenas copia se não souber processar bem
        return filePath;
      }

      // Substitui o original pelo comprimido
      await unlink(filePath);
      await rename(tempPath, filePath);
      
      console.log(`[MediaService] Imagem comprimida: ${filePath}`);
      return filePath;
    } catch (error) {
      console.error(`[MediaService] Erro ao comprimir imagem ${filePath}:`, error);
      if (fs.existsSync(tempPath)) await unlink(tempPath);
      return filePath; // Retorna o original em caso de erro
    }
  }

  /**
   * Comprime um vídeo e substitui o arquivo original
   */
  static async compressVideo(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    const tempPath = `${filePath}_temp.mp4`; // Padroniza para mp4 comprimido

    return new Promise((resolve) => {
      ffmpeg(filePath)
        .outputOptions([
          '-c:v libx264',
          '-crf 28', // Constant Rate Factor (23 is default, 28 is good quality/size balance)
          '-preset faster',
          '-c:a aac',
          '-b:a 128k',
          '-movflags +faststart' // Melhora o carregamento web
        ])
        .on('end', async () => {
          try {
            await unlink(filePath);
            const finalPath = filePath.endsWith('.mp4') ? filePath : `${filePath.slice(0, -ext.length)}.mp4`;
            await rename(tempPath, finalPath);
            console.log(`[MediaService] Vídeo comprimido: ${finalPath}`);
            resolve(finalPath);
          } catch (err) {
            console.error('[MediaService] Erro ao finalizar compressão de vídeo:', err);
            resolve(filePath);
          }
        })
        .on('error', (err) => {
          console.warn(`[MediaService] Falha na compressão de vídeo (FFmpeg pode estar ausente): ${err.message}`);
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          resolve(filePath);
        })
        .save(tempPath);
    });
  }

  /**
   * Comprime um áudio e substitui o arquivo original
   */
  static async compressAudio(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    const tempPath = `${filePath}_temp.mp3`;

    return new Promise((resolve) => {
      ffmpeg(filePath)
        .audioCodec('libmp3lame')
        .audioBitrate(128)
        .on('end', async () => {
          try {
            await unlink(filePath);
            const finalPath = filePath.endsWith('.mp3') ? filePath : `${filePath.slice(0, -ext.length)}.mp3`;
            await rename(tempPath, finalPath);
            console.log(`[MediaService] Áudio comprimido: ${finalPath}`);
            resolve(finalPath);
          } catch (err) {
            console.error('[MediaService] Erro ao finalizar compressão de áudio:', err);
            resolve(filePath);
          }
        })
        .on('error', (err) => {
          console.warn(`[MediaService] Falha na compressão de áudio (FFmpeg pode estar ausente): ${err.message}`);
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          resolve(filePath);
        })
        .save(tempPath);
    });
  }
}
