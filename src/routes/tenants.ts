import { Router } from "express";
import { prisma } from "../prisma.js";
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
        mapImageUrl: true,
        latitude: true,
        longitude: true
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
    if (!name || !slug || !adminEmail || !adminPassword) {
      return res.status(400).json({ message: "Campos obrigatórios faltando" });
    }

    let maxWorks = 50;
    if (plan === "PRO") maxWorks = 200;
    if (plan === "ENTERPRISE") maxWorks = 500;

    const existsSlug = await prisma.tenant.findUnique({ where: { slug } });
    if (existsSlug) {
      return res.status(400).json({ message: "Slug já em uso" });
    }

    const bcrypt = await import("bcrypt");
    const hash = await bcrypt.default.hash(adminPassword, 10);

    const tenant = await prisma.tenant.create({
      data: {
        name,
        slug,
        // @ts-ignore
        plan: plan || "START",
        // @ts-ignore
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
  } catch (err) {
    console.error("Erro criar tenant", err);
    return res.status(500).json({ message: "Erro ao criar tenant" });
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

// Atualiza tenant (MASTER) - Apenas dados estruturais/plano
router.put("/:id", authMiddleware, requireRole([Role.MASTER]), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, plan, maxWorks, logoUrl, signatureUrl, certificateBackgroundUrl } = req.body;

    // Convert maxWorks to number if present
    const maxWorksInt = maxWorks ? parseInt(maxWorks) : undefined;

    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        name,
        slug,
        // @ts-ignore
        plan: plan,
        // @ts-ignore
        maxWorks: maxWorksInt,
        logoUrl,
        signatureUrl,
        certificateBackgroundUrl
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
