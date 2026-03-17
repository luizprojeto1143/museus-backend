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
  latitude: z.any().optional().transform(v => {
    if (v === null || v === "" || v === undefined) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }),
  longitude: z.any().optional().transform(v => {
    if (v === null || v === "" || v === undefined) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  theme: z.string().optional(),
  historicalFont: z.boolean().or(z.string().transform(v => v === 'true')).optional(),
  name: z.string().optional(),
  // Welcome Audio/Video
  welcomeAudioUrl: z.string().optional().nullable(),
  welcomeVideoUrl: z.string().optional().nullable(),
  frameUrl: z.string().optional().nullable(),

  // Legal
  termsOfUse: z.string().optional(),
  privacyPolicy: z.string().optional()
});

function test(data, label) {
    const result = settingsSchema.safeParse(data);
    if (!result.success) {
        console.log(`❌ FAIL [${label}]:`, JSON.stringify(result.error.errors, null, 2));
    } else {
        console.log(`✅ PASS [${label}]:`, result.data);
    }
}

console.log("Starting tests...");

test({ email: null }, "Email as null");
test({ email: "" }, "Email as empty string");
test({ website: null }, "Website as null");
test({ website: "" }, "Website as empty string");
test({ website: "invalid-url" }, "Website as invalid string");
test({ historicalFont: true }, "Historical font boolean");
test({ historicalFont: "true" }, "Historical font string true");
test({ logoUrl: null }, "LogoUrl as null");
