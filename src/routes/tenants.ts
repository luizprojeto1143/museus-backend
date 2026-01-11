import { Router } from "express";
import { prisma } from "../prisma.js";
import bcrypt from "bcrypt";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// Lista todos os tenants PUBLIC (sem auth para seleção do visitante)
router.get("/public", async (req, res) => {
  try {
    const tenants = await prisma.tenant.findMany({
      select: {
        id: true,
        name: true,
        slug: true
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
        featureMinigames: true
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
        featureMinigames: true
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

// Detalhes do Tenant (MASTER)
router.get("/:id", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
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
    interface CreateTenantBody {
      name: string;
      slug: string;
      adminEmail: string;
      adminName?: string;
      adminPassword: string;
      plan?: string;
    }

    const { name, slug, adminEmail, adminName, adminPassword, plan } = req.body as CreateTenantBody;

    // Validation
    if (!name || !slug || !adminEmail || !adminPassword) {
      return res.status(400).json({
        message: "Campos obrigatórios faltando",
        errors: [
          !name && { field: "name", message: "Nome é obrigatório" },
          !slug && { field: "slug", message: "Slug é obrigatório" },
          !adminEmail && { field: "adminEmail", message: "Email do admin é obrigatório" },
          !adminPassword && { field: "adminPassword", message: "Senha do admin é obrigatória" }
        ].filter(Boolean)
      });
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
  } catch (err: any) {
    console.error("Erro criar tenant", err);

    // Handle Prisma unique constraint errors
    if (err.code === 'P2002') {
      const target = err.meta?.target;
      if (target?.includes('email')) {
        return res.status(400).json({ message: "Email do admin já está em uso" });
      }
      if (target?.includes('slug')) {
        return res.status(400).json({ message: "Slug já em uso" });
      }
      return res.status(400).json({ message: "Valor duplicado detectado" });
    }

    return res.status(500).json({ message: "Erro ao criar tenant", details: err.message });
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

    const {
      mission, address, openingHours, whatsapp, email, website,
      logoUrl, coverImageUrl, appIconUrl, bannerUrl, signatureUrl, certificateBackgroundUrl,
      mapImageUrl, latitude, longitude,
      primaryColor, secondaryColor, theme, historicalFont,
      name // Admin também pode querer alterar o nome de exibição
    } = req.body;

    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        mission, address, openingHours, whatsapp, email, website,
        logoUrl, coverImageUrl, appIconUrl, bannerUrl, signatureUrl, certificateBackgroundUrl,
        mapImageUrl,
        latitude: latitude ? parseFloat(latitude) : undefined,
        longitude: longitude ? parseFloat(longitude) : undefined,
        primaryColor, secondaryColor, theme, historicalFont,
        name
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
      featureCertificates, featureReviews, featureGuestbook, featureAccessibility, featureMinigames
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
        // Feature Flags (only update if provided)
        ...(featureWorks !== undefined && { featureWorks }),
        ...(featureTrails !== undefined && { featureTrails }),
        ...(featureEvents !== undefined && { featureEvents }),
        ...(featureGamification !== undefined && { featureGamification }),
        ...(featureQRCodes !== undefined && { featureQRCodes }),
        ...(featureChatAI !== undefined && { featureChatAI }),
        ...(featureShop !== undefined && { featureShop }),
        ...(featureDonations !== undefined && { featureDonations }),
        ...(featureCertificates !== undefined && { featureCertificates }),
        ...(featureReviews !== undefined && { featureReviews }),
        ...(featureGuestbook !== undefined && { featureGuestbook }),

        ...(featureAccessibility !== undefined && { featureAccessibility }),
        ...(featureMinigames !== undefined && { featureMinigames })
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
