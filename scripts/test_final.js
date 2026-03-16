import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import { z } from 'zod';

// Mock do schema de produto
const productSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  description: z.string().optional(),
  price: z.any().transform(v => {
    if (v === null || v === "" || v === undefined) return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }).refine(v => v >= 0, "Preço não pode ser negativo"),
  imageUrl: z.string().optional(),
  category: z.string().optional(),
  sku: z.string().optional(),
  stock: z.any().transform(v => {
    if (v === null || v === "" || v === undefined) return 0;
    const n = Math.floor(Number(v));
    return isNaN(n) ? 0 : n;
  }).refine(v => v >= 0, "Estoque não pode ser negativo"),
  active: z.boolean().default(true)
});

async function test() {
  console.log("--- Testing Product Validation ---");
  const badProduct = {
    name: "Cálice de Ouro",
    price: NaN,
    stock: "invalid"
  };

  const result = productSchema.safeParse(badProduct);
  if (result.success) {
    console.log("Success (Transformed):", result.data);
  } else {
    console.error("Validation Failed:", result.error.errors);
  }

  console.log("\n--- Testing Coordinate Validation ---");
  const id = "8cc9b546-7f7d-4908-a6cf-acdd7b86982b";
  try {
     const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        latitude: null, // Testando null
        longitude: null
      }
    });
    console.log("Tenant update success with null coords");
  } catch (err) {
    console.error("Tenant update failed:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();
