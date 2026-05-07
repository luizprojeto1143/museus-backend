import { z } from "zod";
import { Role } from "@prisma/client";

export const createUserSchema = z.object({
    body: z.object({
        email: z.string().email("Email inválido"),
        password: z.string().min(6, "A senha deve ter no mínimo 6 caracteres"),
        name: z.string().min(1, "Nome é obrigatório"),
        role: z.nativeEnum(Role, { errorMap: () => ({ message: "Role inválido" }) }),
        tenantId: z.string().optional().nullable(),
        permissions: z.any().optional().nullable()
    }).refine((data) => {
        if (data.role === Role.ADMIN && !data.tenantId) {
            return false;
        }
        return true;
    }, {
        message: "Tenant ID é obrigatório para administradores",
        path: ["tenantId"]
    })
});

export const updateUserSchema = z.object({
    body: z.object({
        email: z.string().email("Email inválido").optional(),
        password: z.string().min(6).optional(),
        name: z.string().optional(),
        role: z.nativeEnum(Role).optional(),
        tenantId: z.string().optional().nullable(),
        permissions: z.any().optional().nullable()
    })
});
