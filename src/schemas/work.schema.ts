import { z } from "zod";

// Schema for creating/updating works
export const createWorkSchema = z.object({
    body: z.object({
        title: z.string().min(1, "Título é obrigatório"),
        description: z.string().optional(),
        artist: z.string().optional(),
        year: z.string().optional(),
        technique: z.string().optional(),
        dimensions: z.string().optional(),
        period: z.string().optional(),
        medium: z.string().optional(),
        room: z.string().optional(),
        floor: z.string().optional(),
        location: z.string().optional(),
        imageUrl: z.string().url().optional().nullable(),
        audioUrl: z.string().url().optional().nullable(),
        videoUrl: z.string().url().optional().nullable(),
        librasUrl: z.string().url().optional().nullable(),
        audioDescriptionUrl: z.string().url().optional().nullable(),
        qrCode: z.string().optional().nullable(),
        code: z.string().optional().nullable(),
        categoryId: z.string().uuid().optional().nullable(),
        isAccessible: z.boolean().optional(),
        order: z.number().int().optional(),
        radius: z.number().int().optional(),
        lat: z.number().optional().nullable(),
        lng: z.number().optional().nullable(),
        captureRadiusM: z.number().optional().nullable(),
        vestigeActive: z.boolean().optional(),
        vestigeType: z.enum(["WORK", "STREET_ART", "INSTALLATION", "EVENT"]).optional().nullable(),
        vestigeExpiresAt: z.string().optional().nullable(),
        vestigeImageUrl: z.string().url().optional().nullable(),
        metadata: z.any().optional(),
        equipamentoId: z.string().optional().nullable()
    })
});

export const updateWorkSchema = z.object({
    params: z.object({
        id: z.string().uuid("ID inválido")
    }),
    body: createWorkSchema.shape.body.partial()
});

// Schema for work search/filter
export const searchWorksSchema = z.object({
    query: z.object({
        search: z.string().optional(),
        categoryId: z.string().uuid().optional(),
        isHighlight: z.enum(["true", "false"]).optional(),
        equipamentoId: z.string().optional(),
        page: z.string().regex(/^\d+$/).optional(),
        limit: z.string().regex(/^\d+$/).optional()
    })
});
