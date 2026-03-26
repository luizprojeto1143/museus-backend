import { MediaService } from '../services/mediaService';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

sharp.cache(false);

describe('MediaService Compression', () => {
  const testDir = path.join(process.cwd(), 'uploads', 'test');
  const largeImagePath = path.join(testDir, 'large_test.jpg');

  beforeAll(async () => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Cria uma imagem grande de teste (2000x2000 pixel, cor sólida)
    await sharp({
      create: {
        width: 2000,
        height: 2000,
        channels: 3,
        background: { r: 255, g: 0, b: 0 }
      }
    })
    .jpeg()
    .toFile(largeImagePath);
  });

  afterAll(() => {
    if (fs.existsSync(largeImagePath)) {
      fs.unlinkSync(largeImagePath);
    }
  });

  it('should compress image and reduce dimensions', async () => {
    const initialStats = fs.statSync(largeImagePath);
    const initialMetadata = await sharp(largeImagePath).metadata();

    expect(initialMetadata.width).toBe(2000);

    await MediaService.compressImage(largeImagePath);

    const finalStats = fs.statSync(largeImagePath);
    const finalMetadata = await sharp(largeImagePath).metadata();

    expect(finalMetadata.width).toBe(1920);
    // Nota: Compressão de uma cor sólida pode não reduzir drasticamente o tamanho, 
    // mas a largura deve ser alterada conforme MAX_IMAGE_WIDTH=1920.
    console.log(`Tamanho inicial: ${initialStats.size}, Tamanho final: ${finalStats.size}`);
  });

  it('should handle video compression gracefully even if ffmpeg fails', async () => {
    // Cria um arquivo falso que "parece" um vídeo
    const fakeVideoPath = path.join(testDir, 'fake.mp4');
    fs.writeFileSync(fakeVideoPath, 'not a video');

    // Não deve estourar erro mesmo se FFmpeg falhar (deve retornar o original)
    const result = await MediaService.compressVideo(fakeVideoPath);
    expect(result).toBeDefined();
    
    if (fs.existsSync(fakeVideoPath)) fs.unlinkSync(fakeVideoPath);
    const tempVideo = `${fakeVideoPath}_temp.mp4`;
    if (fs.existsSync(tempVideo)) fs.unlinkSync(tempVideo);
  });
});
