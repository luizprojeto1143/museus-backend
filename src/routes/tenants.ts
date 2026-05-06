import { Router } from "express";
import { prisma } from "../prisma.js";
import bcrypt from "bcrypt";
import { authMiddleware, requireRole, softAuthMiddleware } from "../middleware/auth.js";
import { Role, TenantType } from "@prisma/client";
import { z } from "zod";
import { limiter } from "../middleware/rateLimiter.js";
import { createAuditLog } from "./audit.js";

const router = Router();

// Lista todos os tenants PUBLIC (sem auth para seleção do visitante)
// SECURITY: Rate Limit prevent Scraping (CRIT-005)
// PERF: Added basic pagination limit
router.get("/public", limiter, async (req, res) => {
  try {
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        coverImageUrl: true,
        latitude: true,
        longitude: true,
        openingHours: true,
        address: true // Often contains city
      },
      orderBy: { name: "asc" }
    });
    return res.json(tenants);
  } catch (err) {
    console.error("❌ CRITICAL: Erro ao listar museus públicos na rota /public");
    console.error("Error Object:", err);
    if (err instanceof Error) {
      console.error("Message:", err.message);
      console.error("Stack:", err.stack);
    }
    // Check if it's a Prisma error
    if (typeof err === 'object' && err !== null && 'code' in err) {
      console.error("Prisma Error Code:", (err as any).code);
      console.error("Prisma Metadata:", (err as any).meta);
    }

    return res.status(500).json({ 
      message: "Erro ao listar museus. Por favor, verifique o status do banco de dados.",
      error: err instanceof Error ? err.message : String(err),
      code: (err as any)?.code || "UNKNOWN_ERROR"
    });
  }
});

/**
 * Get Tenant Settings
 * Handled as a single endpoint for both public and authenticated users.
 * Public users get a subset of fields.
 */
router.get("/:id/settings", softAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Determine if requester is authorized for all fields (Master or Admin of this tenant)
    const isAuthorized = user && (user.role === Role.MASTER || (user.role === Role.ADMIN && user.tenantId === id));

    const tenant = await prisma.tenant.findFirst({
      where: { id, deletedAt: null }
    });

    if (!tenant) {
      return res.status(404).json({ message: "Museu não encontrado" });
    }

    if (isAuthorized) {
      return res.json(tenant); // Return everything for Admins
    }

    // Filtered settings for public visitors
    const publicSettings = {
      name: tenant.name,
      type: tenant.type,
      logoUrl: tenant.logoUrl,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      historicalFont: tenant.historicalFont,
      mapImageUrl: tenant.mapImageUrl,
      latitude: tenant.latitude,
      longitude: tenant.longitude,
      // Welcome Media
      welcomeAudioUrl: tenant.welcomeAudioUrl,
      welcomeVideoUrl: tenant.welcomeVideoUrl,
      // Feature Flags
      featureWorks: tenant.featureWorks,
      featureTrails: tenant.featureTrails,
      featureEvents: tenant.featureEvents,
      featureGamification: tenant.featureGamification,
      featureQRCodes: tenant.featureQRCodes,
      featureChatAI: tenant.featureChatAI,
      featureShop: tenant.featureShop,
      featureDonations: tenant.featureDonations,
      featureCertificates: tenant.featureCertificates,
      featureReviews: tenant.featureReviews,
      featureGuestbook: tenant.featureGuestbook,
      featureAccessibility: tenant.featureAccessibility,
      featureMinigames: tenant.featureMinigames,
      isCityMode: tenant.isCityMode,
      featureEditaisSubmission: tenant.featureEditaisSubmission,
      // Municipal Features
      featureEditais: tenant.featureEditais,
      featureProjects: tenant.featureProjects,
      featureProviders: tenant.featureProviders,
      featureAccessibilityMgmt: tenant.featureAccessibilityMgmt,
      featureInstitutionalReports: tenant.featureInstitutionalReports,
      featureTickets: tenant.featureTickets,
      featureGroupContent: tenant.featureGroupContent,
      featureGroupEvents: tenant.featureGroupEvents,
      featureGroupEngagement: tenant.featureGroupEngagement,
      featureGroupGamification: tenant.featureGroupGamification,
      featureGroupInstitutional: tenant.featureGroupInstitutional,
      featureGroupTools: tenant.featureGroupTools,
      featureGroupAnalytics: tenant.featureGroupAnalytics,
      featureGroupSocial: tenant.featureGroupSocial,
      featureGroupPreservation: tenant.featureGroupPreservation,
      featureGroupAI: tenant.featureGroupAI,
      featureGroupRoadmap: tenant.featureGroupRoadmap,
      // Added missing common fields for better UI
      mission: tenant.mission,
      address: tenant.address,
      openingHours: tenant.openingHours,
      bannerUrl: tenant.bannerUrl,
      coverImageUrl: tenant.coverImageUrl,
      appIconUrl: tenant.appIconUrl,
      frameUrl: tenant.frameUrl,
      whatsapp: tenant.whatsapp,
      email: tenant.email,
      website: tenant.website,
      theme: tenant.theme
    };

    return res.json(publicSettings);
  } catch (err) {
    console.error("Erro ao buscar configurações do museu:", err);
    return res.status(500).json({ 
      message: "Erro interno",
      error: err instanceof Error ? err.message : String(err)
    });
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
        featureEditaisSubmission: true,
        // Municipal Features
        featureEditais: true,
        featureProjects: true,
        featureProviders: true,
        featureAccessibilityMgmt: true,
        featureInstitutionalReports: true,
        featureTickets: true
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

// Lista todos os tenants (MASTER) ou Sub-tenants (ADMIN)
router.get("/", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
  try {
    const user = req.user!;
    const { parentId } = req.query;

    const where: any = {};

    // Se for ADMIN, obrigatoriamente tem que filtrar pelo seu tenantId (listar seus filhos)
    if (user.role === Role.ADMIN) {
      if (!parentId || parentId !== user.tenantId) {
        return res.status(403).json({ message: "Admins só podem listar seus próprios equipamentos (sub-tenants)" });
      }
      where.parentId = user.tenantId;
    } else {
      // MASTER pode filtrar se quiser
      if (parentId) {
        where.parentId = String(parentId);
      }
    }

    where.deletedAt = null;

    const tenants = await prisma.tenant.findMany({
      where: {
        ...where,
        deletedAt: null
      },
      orderBy: { createdAt: "desc" }
    });
    return res.json(tenants);
  } catch (err) {
    console.error("Erro ao listar museus:", err);
    return res.status(500).json({
      message: "Erro ao listar museus",
      error: err instanceof Error ? err.message : String(err)
    });
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
    console.error("Erro ao buscar tenant:", err);
    return res.status(500).json({ 
      message: "Erro ao buscar tenant",
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

// Cria tenant + admin
router.post("/", authMiddleware, requireRole([Role.MASTER, Role.ADMIN]), async (req, res) => {
  try {
    const user = req.user!;
    const createTenantSchema = z.object({
      name: z.string().min(1, "Nome é obrigatório"),
      slug: z.string().min(1, "Slug é obrigatório"),
      type: z.nativeEnum(TenantType).optional(),
      parentId: z.string().optional().nullable(), // Allow sending parentId
      isCityMode: z.boolean().optional(),
      adminEmail: z.string().email("Email do admin inválido"),
      adminName: z.string().optional(),
      adminPassword: z.string().min(6, "Senha do admin deve ter no mínimo 6 caracteres"),
      plan: z.string().optional(),
      // Feature Flags
      featureWorks: z.boolean().optional(),
      featureTrails: z.boolean().optional(),
      featureEvents: z.boolean().optional(),
      featureGamification: z.boolean().optional(),
      featureQRCodes: z.boolean().optional(),
      featureChatAI: z.boolean().optional(),
      featureShop: z.boolean().optional(),
      featureDonations: z.boolean().optional(),
      featureCertificates: z.boolean().optional(),
      featureReviews: z.boolean().optional(),
      featureGuestbook: z.boolean().optional(),
      featureAccessibility: z.boolean().optional(),
      featureEditais: z.boolean().optional(),
      featureMinigames: z.boolean().optional(),
      featureProjects: z.boolean().optional(),
      featureProviders: z.boolean().optional(),
      featureAccessibilityMgmt: z.boolean().optional(),
      featureInstitutionalReports: z.boolean().optional(),
      featureEditaisSubmission: z.boolean().optional(),
      featureTickets: z.boolean().optional(),
      featureGroupContent: z.boolean().optional(),
      featureGroupEvents: z.boolean().optional(),
      featureGroupEngagement: z.boolean().optional(),
      featureGroupGamification: z.boolean().optional(),
      featureGroupInstitutional: z.boolean().optional(),
      featureGroupTools: z.boolean().optional(),
      featureGroupAnalytics: z.boolean().optional(),
      featureGroupSocial: z.boolean().optional(),
      featureGroupPreservation: z.boolean().optional(),
      featureGroupAI: z.boolean().optional(),
      featureGroupRoadmap: z.boolean().optional()
    });

    const data = createTenantSchema.parse(req.body);
    const { name, slug, type, isCityMode, adminEmail, adminName, adminPassword, plan } = data;

    // Enforce logic for ADMIN
    let finalParentId = data.parentId;
    if (user.role === Role.ADMIN) {
      // Admin can only create child tenants of their own tenant
      finalParentId = user.tenantId;

      // Admin cannot create CITY (only MASTER can)
      if (type === TenantType.CITY) {
        return res.status(403).json({ message: "Admin não pode criar tenants do tipo Cidade" });
      }
    }

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
        type: type || TenantType.MUSEUM,
        parentId: finalParentId, // Use enforced parentId
        isCityMode: isCityMode || false,
        plan: plan || "START",
        maxWorks,
        // Feature Flags
        featureWorks: data.featureWorks,
        featureTrails: data.featureTrails,
        featureEvents: data.featureEvents,
        featureGamification: data.featureGamification,
        featureQRCodes: data.featureQRCodes,
        featureChatAI: data.featureChatAI,
        featureShop: data.featureShop,
        featureDonations: data.featureDonations,
        featureCertificates: data.featureCertificates,
        featureReviews: data.featureReviews,
        featureGuestbook: data.featureGuestbook,
        featureAccessibility: data.featureAccessibility,
        featureEditais: data.featureEditais,
        featureMinigames: data.featureMinigames,
        featureProjects: data.featureProjects,
        featureProviders: data.featureProviders,
        featureAccessibilityMgmt: data.featureAccessibilityMgmt,
        featureInstitutionalReports: data.featureInstitutionalReports,
        featureEditaisSubmission: data.featureEditaisSubmission,
        featureTickets: data.featureTickets,
        featureGroupContent: data.featureGroupContent,
        featureGroupEvents: data.featureGroupEvents,
        featureGroupEngagement: data.featureGroupEngagement,
        featureGroupGamification: data.featureGroupGamification,
        featureGroupInstitutional: data.featureGroupInstitutional,
        featureGroupTools: data.featureGroupTools,
        featureGroupAnalytics: data.featureGroupAnalytics,
        featureGroupSocial: data.featureGroupSocial,
        featureGroupPreservation: data.featureGroupPreservation,
        featureGroupAI: data.featureGroupAI,
        featureGroupRoadmap: data.featureGroupRoadmap,
        users: {
          create: [
            {
              email: adminEmail,
              name: adminName || "Admin",
              password: hash,
              role: Role.ADMIN
            }
          ]
        },
        equipamentos: (type !== TenantType.CITY && type !== TenantType.SECRETARIA) ? {
          create: [
            {
              nome: `Sede - ${name}`,
              slug: `${slug}-sede`,
              tipo: type === TenantType.PRODUCER ? 'produtora' : type === TenantType.CULTURAL_SPACE ? 'espaço' : 'museu',
              endereco: 'Endereço Principal',
              cidade: 'Sua Cidade',
              estado: 'BR'
            }
          ]
        } : undefined
      },
      include: { users: true }
    });

    await createAuditLog(
      'CREATE',
      'Tenant',
      tenant.id,
      user.id,
      user.email,
      tenant.id,
      null,
      tenant,
      req
    );

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

// This route is now merged into the one above

// Atualiza configurações do tenant (ADMIN ou MASTER)
router.put("/:id/settings", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  const { id } = req.params;
  const user = req.user!;

  try {
    // Se for ADMIN, só pode alterar seu próprio tenant
    if (user.role === Role.ADMIN && user.tenantId !== id) {
      return res.status(403).json({ message: "Sem permissão para alterar outro museu" });
    }

    const settingsSchema = z.object({
      mission: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
      openingHours: z.string().nullable().optional(),
      whatsapp: z.string().nullable().optional(),
      email: z.preprocess(v => (v === "" || v === null) ? null : v, z.string().email().nullable().optional()),
      website: z.preprocess(v => {
        if (v === "" || v === null) return null;
        let s = String(v);
        if (!s.startsWith('http')) s = `https://${s}`;
        return s;
      }, z.string().url().nullable().optional()),
      logoUrl: z.string().nullable().optional(),
      coverImageUrl: z.string().nullable().optional(),
      appIconUrl: z.string().nullable().optional(),
      bannerUrl: z.string().nullable().optional(),
      signatureUrl: z.string().nullable().optional(),
      certificateBackgroundUrl: z.string().nullable().optional(),
      mapImageUrl: z.string().nullable().optional(),
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
      historicalFont: z.any().optional().transform(v => {
        if (v === 'true' || v === true) return true;
        if (v === 'false' || v === false) return false;
        return false;
      }),
      name: z.string().optional(),
      // Welcome Audio/Video
      welcomeAudioUrl: z.string().optional().nullable(),
      welcomeVideoUrl: z.string().optional().nullable(),
      frameUrl: z.string().optional().nullable(),

      // Legal
      termsOfUse: z.string().nullable().optional(),
      privacyPolicy: z.string().nullable().optional()
    });

    const result = settingsSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ 
        message: "Dados de configuração inválidos", 
        errors: result.error.errors 
      });
    }
    const data = result.data;

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
        frameUrl: data.frameUrl,
        termsOfUse: data.termsOfUse,
        privacyPolicy: data.privacyPolicy
      }
    });

    return res.json(tenant);
  } catch (err) {
    console.error("Erro ao atualizar configurações:", err);
    
    // Log do erro para auditoria
    await createAuditLog(
      'SETTINGS_UPDATE_ERROR',
      'Tenant',
      id,
      user.id,
      user.email,
      id,
      null,
      { error: err instanceof Error ? err.message : String(err), data: req.body },
      req
    ).catch(e => console.error("Falha ao logar erro de settings:", e));

    return res.status(500).json({ 
      message: "Erro ao atualizar configurações",
      error: err instanceof Error ? err.message : String(err),
      stack: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.stack : undefined) : undefined
    });
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
      isCityMode,
      // Municipal Features
      featureEditais, featureProjects, featureProviders, featureAccessibilityMgmt, featureInstitutionalReports,
      featureEditaisSubmission, featureTickets,
      featureGroupContent, featureGroupEvents, featureGroupEngagement, featureGroupGamification,
      featureGroupInstitutional, featureGroupTools, featureGroupAnalytics, featureGroupSocial,
      featureGroupPreservation, featureGroupAI, featureGroupRoadmap
    } = req.body;

    // Convert maxWorks to number if present
    const maxWorksInt = maxWorks ? parseInt(maxWorks) : undefined;

    const oldTenant = await prisma.tenant.findUnique({ where: { id } });

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
        ...(isCityMode !== undefined && { isCityMode: Boolean(isCityMode) }),
        // Municipal Features
        ...(featureEditais !== undefined && { featureEditais: Boolean(featureEditais) }),
        ...(featureProjects !== undefined && { featureProjects: Boolean(featureProjects) }),
        ...(featureProviders !== undefined && { featureProviders: Boolean(featureProviders) }),
        ...(featureAccessibilityMgmt !== undefined && { featureAccessibilityMgmt: Boolean(featureAccessibilityMgmt) }),
        ...(featureInstitutionalReports !== undefined && { featureInstitutionalReports: Boolean(featureInstitutionalReports) }),
        ...(featureEditaisSubmission !== undefined && { featureEditaisSubmission: Boolean(featureEditaisSubmission) }),
        ...(featureTickets !== undefined && { featureTickets: Boolean(featureTickets) }),
        ...(featureGroupContent !== undefined && { featureGroupContent: Boolean(featureGroupContent) }),
        ...(featureGroupEvents !== undefined && { featureGroupEvents: Boolean(featureGroupEvents) }),
        ...(featureGroupEngagement !== undefined && { featureGroupEngagement: Boolean(featureGroupEngagement) }),
        ...(featureGroupGamification !== undefined && { featureGroupGamification: Boolean(featureGroupGamification) }),
        ...(featureGroupInstitutional !== undefined && { featureGroupInstitutional: Boolean(featureGroupInstitutional) }),
        ...(featureGroupTools !== undefined && { featureGroupTools: Boolean(featureGroupTools) }),
        ...(featureGroupAnalytics !== undefined && { featureGroupAnalytics: Boolean(featureGroupAnalytics) }),
        ...(featureGroupSocial !== undefined && { featureGroupSocial: Boolean(featureGroupSocial) }),
        ...(featureGroupPreservation !== undefined && { featureGroupPreservation: Boolean(featureGroupPreservation) }),
        ...(featureGroupAI !== undefined && { featureGroupAI: Boolean(featureGroupAI) }),
        ...(featureGroupRoadmap !== undefined && { featureGroupRoadmap: Boolean(featureGroupRoadmap) })
      }
    });

    await createAuditLog(
      'UPDATE',
      'Tenant',
      id,
      req.user!.id,
      req.user!.email,
      id,
      oldTenant,
      tenant,
      req
    );

    return res.json(tenant);
  } catch (err) {
    console.error("Erro atualizar tenant", err);
    return res.status(500).json({ message: "Erro ao atualizar tenant" });
  }
});

// Delete Tenant (MASTER ONLY strictly protected)
router.delete("/:id", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const { hard, confirm } = req.query; // ?hard=true&confirm=SLUG
    const user = req.user!;

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return res.status(404).json({ message: "Tenant não encontrado" });

    const shouldHardDelete = hard === "true";

    if (shouldHardDelete) {
      // STRICT CONFIRMATION: Must provide slug to hard delete
      if (confirm !== tenant.slug) {
        return res.status(400).json({ 
          message: "Para exclusão PERMANENTE, você deve confirmar enviando o slug do museu no parâmetro ?confirm=SLUG",
          requiredSlug: tenant.slug
        });
      }

      // Check for impact
      const [workCount, userCount, eventCount] = await Promise.all([
        prisma.work.count({ where: { tenantId: id } }),
        prisma.user.count({ where: { tenantId: id, role: { not: Role.MASTER } } }),
        prisma.event.count({ where: { tenantId: id } })
      ]);

      if ((workCount > 0 || userCount > 0 || eventCount > 0)) {
        console.warn(`[Tenant] Hard deleting tenant ${id} with active data: Works=${workCount}, Users=${userCount}, Events=${eventCount}`);
      }

      // 1. Delete from storage (Assets)
      const { deleteFromStorage } = await import("./upload.js");
      if (tenant.logoUrl) deleteFromStorage(tenant.logoUrl).catch(console.error);
      if (tenant.coverImageUrl) deleteFromStorage(tenant.coverImageUrl).catch(console.error);
      if (tenant.bannerUrl) deleteFromStorage(tenant.bannerUrl).catch(console.error);

      // 2. Cascade delete will be handled by DB (onDelete: Cascade)
      await prisma.tenant.delete({ where: { id } });
      
      console.log(`[Tenant] Hard deleted tenant ${id} and all its data by MASTER`);
    } else {
      // Soft Delete - Mark as deleted
      await prisma.tenant.update({
        where: { id },
        data: { deletedAt: new Date() }
      });
      console.log(`[Tenant] Soft deleted tenant ${id}`);
    }


    await createAuditLog(
      shouldHardDelete ? 'HARD_DELETE' : 'SOFT_DELETE',
      'Tenant',
      id,
      user.id,
      user.email,
      id,
      tenant,
      null,
      req
    );

    return res.status(204).send();
  } catch (err) {
    console.error("Erro deletar tenant", err);
    return res.status(500).json({ message: "Erro ao deletar tenant" });
  }
});

// Clean Demo Data (MASTER)
router.delete("/utils/demo", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    const { count } = await prisma.tenant.deleteMany({
      where: {
        OR: [
          { slug: { in: ['museu-a', 'cidade-b', 'demo', 'exemplo'] } },
          { slug: { contains: 'demo', mode: 'insensitive' } },
          { slug: { contains: 'teste', mode: 'insensitive' } },
          { slug: { contains: 'exemplo', mode: 'insensitive' } },
          { slug: { contains: 'betim', mode: 'insensitive' } },
          { name: { contains: 'Equipamento Padrão', mode: 'insensitive' } },
          { name: { contains: 'demo', mode: 'insensitive' } },
          { name: { contains: 'teste', mode: 'insensitive' } },
          { name: { contains: 'exemplo', mode: 'insensitive' } }
        ]
      }
    });

    console.log(`[Cleaner] Master removed ${count} demo/test tenants.`);
    return res.json({ message: `Removidos ${count} tenants de demonstração.` });
  } catch (err) {
    console.error("Erro ao limpar dados de demonstração:", err);
    return res.status(500).json({ 
      message: "Erro ao limpar dados de demonstração",
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

export default router;
