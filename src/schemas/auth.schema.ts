import { z } from 'zod';

// ─── Reutilizável ─────────────────────────────────────────────────────────────
const emailField = z.string().email({ message: "E-mail inválido" }).toLowerCase();

const passwordField = z.string()
    .min(6, { message: "A senha deve ter no mínimo 6 caracteres" })
    .max(128, { message: "Senha demasiado longa" });

// ─── Login ────────────────────────────────────────────────────────────────────
export const loginSchema = z.object({
    body: z.object({
        email: emailField,
        password: z.string().min(1, { message: "Senha obrigatória" }),
    }),
});

// ─── Registro ─────────────────────────────────────────────────────────────────
export const registerSchema = z.object({
    body: z.object({
        name: z.string()
            .min(2, { message: "O nome deve ter no mínimo 2 caracteres" })
            .max(120, { message: "Nome demasiado longo" })
            .trim(),
        email: emailField,
        password: passwordField,
        role: z.enum(["VISITOR", "PRODUCER"]).optional().default("VISITOR"),
        tenantId: z.string().uuid().optional().nullable(),
        cpf: z.string().max(20).optional(),
        phone: z.string().max(30).optional(),
        bio: z.string().max(500).optional(),
        website: z.string().url().optional().nullable().or(z.literal("")),
        isTeacher: z.boolean().optional(),
        age: z.coerce.number().optional(),
        parentTenantId: z.string().uuid().optional().nullable(),
    }),
});

// ─── Registro de Prestador ────────────────────────────────────────────────────
export const registerProviderSchema = z.object({
    body: z.object({
        name: z.string()
            .min(2, { message: "O nome deve ter no mínimo 2 caracteres" })
            .max(120, { message: "Nome demasiado longo" })
            .trim(),
        email: emailField,
        password: passwordField,
        services: z.array(z.string()).optional(),
        description: z.string().max(1000).optional(),
    }),
});

// ─── Troca de museu ───────────────────────────────────────────────────────────
export const switchTenantSchema = z.object({
    body: z.object({
        targetTenantId: z.string().uuid({ message: "ID do museu inválido" }),
    }),
});

// ─── Registro de Tenant (Master) ──────────────────────────────────────────────
export const registerTenantSchema = z.object({
    body: z.object({
        projectName: z.string()
            .min(3, { message: "O nome do projeto/museu deve ter no mínimo 3 caracteres" })
            .max(150),
        name: z.string()
            .min(2, { message: "O nome do responsável deve ter no mínimo 2 caracteres" })
            .max(120),
        email: emailField,
        password: passwordField,
    }),
});

// ─── Recuperação de senha ─────────────────────────────────────────────────────
export const recoverPasswordSchema = z.object({
    body: z.object({
        email: emailField,
    }),
});

// ─── Reset de senha ───────────────────────────────────────────────────────────
export const resetPasswordSchema = z.object({
    body: z.object({
        token: z.string().min(10, { message: "Token inválido" }),
        newPassword: passwordField,
    }),
});
