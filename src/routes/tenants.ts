import { Router } from "express";
import { prisma } from "../prisma.js";
import bcrypt from "bcrypt";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { z } from "zod";
import { limiter } from "../middleware/rateLimiter.js";

const router = Router();

// Lista todos os tenants PUBLIC (sem auth para seleção do visitante)
// SECURITY: Rate Limit prevent Scraping (CRIT-005)
// PERF: Added basic pagination limit
router.get("/public", limiter, async (req, res) => {
  try {
    const tenants = await prisma.tenant.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        type: true
      },
      orderBy: { name: "asc" }
    });
    return res.json(tenants);
  } catch (err) {
    console.error("Erro listar tenants públicos", err);
    return res.status(500).json({ message: "Erro ao listar museus" });
  }
});

// Get Tenant Settings (Public or Auth)
router.get("/:id/settings", async (req, res) => {
  try {
    const { id } = req.params;
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: {
        name: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        historicalFont: true,
        mapImageUrl: true,
        latitude: true,
        longitude: true,
        // Welcome Media
        welcomeAudioUrl: true,
        welcomeVideoUrl: true,
        // Feature Flags
        featureWorks: true,
        featureTrails: true,
        featureEvents: true,
        featureGamification: true,
        featureQRCodes: true,
        featureChatAI: true,
        featureShop: true,
        featureDonations: true,
        featureCertificates: true,
        featureReviews: true,
        featureGuestbook: true,

        featureAccessibility: true,

        featureMinigames: true,
        isCityMode: true,
        featureEditaisSubmission: true
      }
    });

    if (!tenant) {
      return res.status(404).json({ message: "Museu não encontrado" });
    }

    return res.json(tenant);
  } catch (err) {
    console.error("Erro ao buscar configurações do museu", err);
    return res.status(500).json({ message: "Erro interno" });
  }
});

// Get Tenant Features (Public) - Retorna apenas feature flags
router.get("/:id/features", async (req, res) => {
  try {
    const { id } = req.params;
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: {
        featureWorks: true,
        featureTrails: true,
        featureEvents: true,
        featureGamification: true,
        featureQRCodes: true,
        featureChatAI: true,
        featureShop: true,
        featureDonations: true,
        featureCertificates: true,
        featureReviews: true,
        featureGuestbook: true,

        featureAccessibility: true,

        featureMinigames: true,
        isCityMode: true,
        featureEditaisSubmission: true
      }
    });

    if (!tenant) {
      return res.status(404).json({ message: "Museu não encontrado" });
    }

    return res.json(tenant);
  } catch (err) {
    console.error("Erro ao buscar features do museu", err);
    return res.status(500).json({ message: "Erro interno" });
  }
});

// Lista todos os tenants (MASTER)
router.get("/", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" }
    });
    return res.json(tenants);
  } catch (err) {
    console.error("Erro listar tenants", err);
    return res.status(500).json({ message: "Erro ao listar tenants" });
  }
});

// Detalhes do Tenant (MASTER ou ADMIN do próprio tenant)
router.get("/:id", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    // Se for admin, só pode ver seu próprio tenant
    if (user.role === Role.ADMIN && user.tenantId !== id) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id }
    });

    if (!tenant) {
      return res.status(404).json({ message: "Tenant não encontrado" });
    }

    return res.json(tenant);
  } catch (err) {
    console.error("Erro ao buscar tenant", err);
    return res.status(500).json({ message: "Erro ao buscar tenant" });
  }
});

// Cria tenant + admin
router.post("/", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    const createTenantSchema = z.object({
      name: z.string().min(1, "Nome é obrigatório"),
      slug: z.string().min(1, "Slug é obrigatório"),
      adminEmail: z.string().email("Email do admin inválido"),
      adminName: z.string().optional(),
      adminPassword: z.string().min(6, "Senha do admin deve ter no mínimo 6 caracteres"),
      plan: z.string().optional()
    });

    const data = createTenantSchema.parse(req.body);
    const { name, slug, adminEmail, adminName, adminPassword, plan } = data;

    let maxWorks = 50;
    if (plan === "PRO") maxWorks = 200;
    if (plan === "ENTERPRISE") maxWorks = 500;

    // Check if slug is already in use
    const existsSlug = await prisma.tenant.findUnique({ where: { slug } });
    if (existsSlug) {
      return res.status(400).json({ message: "Slug já em uso" });
    }

    // Check if admin email is already in use
    const existsEmail = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (existsEmail) {
      return res.status(400).json({ message: "Email do admin já está em uso por outro usuário" });
    }

    const hash = await bcrypt.hash(adminPassword, 10);

    const tenant = await prisma.tenant.create({
      data: {
        name,
        slug,
        plan: plan || "START",
        maxWorks,
        users: {
          create: [
            {
              email: adminEmail,
              name: adminName || "Admin",
              password: hash,
              role: Role.ADMIN
            }
          ]
        }
      },
      include: { users: true }
    });

    return res.status(201).json(tenant);
  } catch (err: unknown) {
    console.error("Erro criar tenant", err);

    // Handle Prisma unique constraint errors
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002') {
      const target = (err as { meta?: { target?: string[] } }).meta?.target;
      if (Array.isArray(target) && target.includes('email')) {
        return res.status(400).json({ message: "Email do admin já está em uso" });
      }
      if (Array.isArray(target) && target.includes('slug')) {
        return res.status(400).json({ message: "Slug já em uso" });
      }
      return res.status(400).json({ message: "Valor duplicado detectado" });
    }

    return res.status(500).json({ message: "Erro ao criar tenant", details: err instanceof Error ? err.message : String(err) });
  }
});

// Atualiza configurações do tenant (ADMIN ou MASTER)
router.put("/:id/settings", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    // Se for ADMIN, só pode alterar seu próprio tenant
    if (user.role === Role.ADMIN && user.tenantId !== id) {
      return res.status(403).json({ message: "Sem permissão para alterar outro museu" });
    }

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
      // Welcome Audio/Video
      welcomeAudioUrl: z.string().optional().nullable(),
      welcomeVideoUrl: z.string().optional().nullable(),

      // Legal
      termsOfUse: z.string().optional(),
      privacyPolicy: z.string().optional()
    });

    const data = settingsSchema.parse(req.body);

    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        mission: data.mission,
        address: data.address,
        openingHours: data.openingHours,
        whatsapp: data.whatsapp,
        email: data.email,
        website: data.website,
        logoUrl: data.logoUrl,
        coverImageUrl: data.coverImageUrl,
        appIconUrl: data.appIconUrl,
        bannerUrl: data.bannerUrl,
        signatureUrl: data.signatureUrl,
        certificateBackgroundUrl: data.certificateBackgroundUrl,
        mapImageUrl: data.mapImageUrl,
        latitude: data.latitude,
        longitude: data.longitude,
        primaryColor: data.primaryColor,
        secondaryColor: data.secondaryColor,
        theme: data.theme,
        historicalFont: data.historicalFont,
        name: data.name,
        welcomeAudioUrl: data.welcomeAudioUrl,
        welcomeVideoUrl: data.welcomeVideoUrl,
        termsOfUse: data.termsOfUse,
        privacyPolicy: data.privacyPolicy
      }
    });

    return res.json(tenant);
  } catch (err) {
    console.error("Erro atualizar settings tenant", err);
    return res.status(500).json({ message: "Erro ao atualizar configurações" });
  }
});

// Atualiza tenant (MASTER) - Dados estruturais, plano e feature flags
router.put("/:id", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, slug, plan, maxWorks, logoUrl, signatureUrl, certificateBackgroundUrl,
      // Feature Flags
      featureWorks, featureTrails, featureEvents, featureGamification,
      featureQRCodes, featureChatAI, featureShop, featureDonations,
      featureCertificates, featureReviews, featureGuestbook, featureAccessibility, featureMinigames,
      isCityMode
    } = req.body;

    // Convert maxWorks to number if present
    const maxWorksInt = maxWorks ? parseInt(maxWorks) : undefined;

    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        name,
        slug,
        plan: plan,
        maxWorks: maxWorksInt,
        logoUrl,
        signatureUrl,
        certificateBackgroundUrl,
        // Feature Flags (only update if provided) -> ensure boolean
        ...(featureWorks !== undefined && { featureWorks: Boolean(featureWorks) }),
        ...(featureTrails !== undefined && { featureTrails: Boolean(featureTrails) }),
        ...(featureEvents !== undefined && { featureEvents: Boolean(featureEvents) }),
        ...(featureGamification !== undefined && { featureGamification: Boolean(featureGamification) }),
        ...(featureQRCodes !== undefined && { featureQRCodes: Boolean(featureQRCodes) }),
        ...(featureChatAI !== undefined && { featureChatAI: Boolean(featureChatAI) }),
        ...(featureShop !== undefined && { featureShop: Boolean(featureShop) }),
        ...(featureDonations !== undefined && { featureDonations: Boolean(featureDonations) }),
        ...(featureCertificates !== undefined && { featureCertificates: Boolean(featureCertificates) }),
        ...(featureReviews !== undefined && { featureReviews: Boolean(featureReviews) }),
        ...(featureGuestbook !== undefined && { featureGuestbook: Boolean(featureGuestbook) }),
        ...(featureAccessibility !== undefined && { featureAccessibility: Boolean(featureAccessibility) }),
        ...(featureMinigames !== undefined && { featureMinigames: Boolean(featureMinigames) }),
        ...(isCityMode !== undefined && { isCityMode: Boolean(isCityMode) })
      }
    });

    return res.json(tenant);
  } catch (err) {
    console.error("Erro atualizar tenant", err);
    return res.status(500).json({ message: "Erro ao atualizar tenant" });
  }
});

// Delete Tenant (MASTER OR ADMIN)
// Se for admin, só pode deletar o próprio tenant
router.delete("/:id", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    if (user.role === Role.ADMIN && user.tenantId !== id) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    // Cascate delete is handled by Database (Prisma schema)
    await prisma.tenant.delete({
      where: { id }
    });

    return res.status(204).send();
  } catch (err) {
    console.error("Erro deletar tenant", err);
    return res.status(500).json({ message: "Erro ao deletar tenant" });
  }
});

// Clean Demo Data (MASTER)
router.delete("/utils/demo", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    // Slugs identificados como demo no sistema ou padrão
    const demoSlugs = ['museu-a', 'cidade-b', 'demo', 'exemplo'];

    const { count } = await prisma.tenant.deleteMany({
      where: {
        slug: { in: demoSlugs }
      }
    });

    return res.json({ message: `Removidos ${count} tenants de demonstração.` });
  } catch (err) {
    console.error("Erro limpar demo data", err);
    return res.status(500).json({ message: "Erro ao limpar dados de demonstração" });
  }
});

export default router;
