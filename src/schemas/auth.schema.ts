import { z } from 'zod';

export const loginSchema = z.object({
    body: z.object({
        email: z.string().email({ message: "Email inválido" }),
        password: z.string().min(6, { message: "A senha deve ter no mínimo 6 caracteres" }),
    }),
});

export const registerSchema = z.object({
    body: z.object({
        name: z.string().min(3, { message: "O nome deve ter no mínimo 3 caracteres" }),
        email: z.string().email({ message: "Email inválido" }),
        password: z.string().min(6, { message: "A senha deve ter no mínimo 6 caracteres" }),
        role: z.enum(["visitor", "admin", "master"]).optional(),
        tenantId: z.string().uuid().optional(),
    }),
});

export const switchTenantSchema = z.object({
    body: z.object({
        targetTenantId: z.string().uuid({ message: "ID do museu inválido" }),
    }),
});
