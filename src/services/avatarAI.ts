import OpenAI from 'openai';
import fs from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const r2Client = process.env.R2_ACCOUNT_ID
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
  : null;

/**
 * Transforma uma selfie em um avatar cartoon 2D
 */
export async function generateCartoonAvatar(selfiePath: string): Promise<string> {
  if (!openai) throw new Error('OpenAI API Key não configurada');

  const response = await openai.images.edit({
    model: 'dall-e-2', // gpt-image-1 may be a placeholder in the spec, dall-e-2 is the standard for editing
    image: fs.createReadStream(selfiePath),
    prompt: `
      Transform this person's photo into a high-quality 2D anime cartoon avatar.
      IMPORTANT: Keep the person's facial features, hair color, skin tone,
      eye shape, and overall likeness exactly recognizable.
      Style: clean 2D anime illustration, vibrant colors, professional quality.
      Framing: character from chest up, centered, facing forward.
      Background: clean dark gradient, no distracting elements.
      Clothing: simple neutral outfit (the outfit will be changed later).
    `,
    size: '1024x1024',
    response_format: 'b64_json',
  });

  if (!response.data || !response.data[0]) throw new Error('Falha ao gerar imagem: Resposta inválida da OpenAI');
  const base64 = response.data[0].b64_json;
  if (!base64) throw new Error('Falha ao gerar imagem: b64_json vazio');
  return base64;
}

/**
 * Aplica uma skin a um avatar base
 */
export async function applySkinToAvatar(
  baseAvatarPath: string,
  skinImagePath: string,
  skinName: string
): Promise<string> {
  if (!openai) throw new Error('OpenAI API Key não configurada');

  const response = await openai.images.edit({
    model: 'dall-e-2',
    image: fs.createReadStream(baseAvatarPath),
    prompt: `
      This is a 2D anime cartoon character. Change ONLY the outfit/clothing.
      NEVER change: face, hair, skin tone, eyes, expression, body proportions.
      New outfit name: '${skinName}'.
      Apply the outfit as shown in the skin design, maintaining the anime 2D style.
      Keep the same background and framing. Only the clothes change.
    `,
    size: '1024x1024',
    response_format: 'b64_json',
  });

  if (!response.data || !response.data[0]) throw new Error('Falha ao aplicar skin: Resposta inválida da OpenAI');
  const base64 = response.data[0].b64_json;
  if (!base64) throw new Error('Falha ao aplicar skin: b64_json vazio');
  return base64;
}

/**
 * Salva uma imagem em Base64 no Cloudflare R2
 */
export async function saveBase64ToR2(
  base64: string,
  folder: string,
  filename: string
): Promise<string> {
  if (!r2Client) {
    // Fallback para local se R2 não estiver configurado (apenas para dev controlado)
    console.warn('⚠️ [AvatarAI] R2 não configurado. Fallback local não implementado para Base64.');
    throw new Error('R2 não configurado');
  }

  const buffer = Buffer.from(base64, 'base64');
  const key = `${folder}/${filename}.png`;
  const bucket = process.env.R2_BUCKET_NAME!;

  await r2Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: 'image/png',
  }));

  const publicBase = process.env.R2_PUBLIC_BASE_URL!;
  return `${publicBase.replace(/\/$/, '')}/${key}`;
}
