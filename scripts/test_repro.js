import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import { z } from 'zod';

const settingsSchema = z.object({
  mission: z.string().optional(),
  address: z.string().optional(),
  openingHours: z.string().optional(),
  whatsapp: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  website: z.string().url().optional().or(z.literal('')),
  logoUrl: z.string().optional(),
  coverImageUrl: z.string().optional(),
  appIconUrl: z.string().optional(),
  bannerUrl: z.string().optional(),
  signatureUrl: z.string().optional(),
  certificateBackgroundUrl: z.string().optional(),
  mapImageUrl: z.string().optional(),
  latitude: z.string().or(z.number()).optional().transform(v => v ? Number(v) : undefined),
  longitude: z.string().or(z.number()).optional().transform(v => v ? Number(v) : undefined),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  theme: z.string().optional(),
  historicalFont: z.boolean().or(z.string().transform(v => v === 'true')).optional(),
  name: z.string().optional(),
  welcomeAudioUrl: z.string().optional().nullable(),
  welcomeVideoUrl: z.string().optional().nullable(),
  frameUrl: z.string().optional().nullable(),
  termsOfUse: z.string().optional(),
  privacyPolicy: z.string().optional()
});

async function test() {
  const id = "8cc9b546-7f7d-4908-a6cf-acdd7b86982b";
  const body = {
    name: "Teste Repro",
    latitude: NaN,
    frameUrl: "test-frame",
    bannerUrl: ""
  };

  try {
    const result = settingsSchema.safeParse(body);
    if (!result.success) {
      console.error("Zod Validation Failed:", result.error.errors);
      return;
    }
    const data = result.data;
    console.log("Parsed data:", data);
    
    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        name: data.name,
        latitude: data.latitude,
        frameUrl: data.frameUrl,
        bannerUrl: data.bannerUrl
      }
    });
    console.log("Success update:", tenant.id);
  } catch (err) {
    console.error("Prisma/Runtime Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

test();
