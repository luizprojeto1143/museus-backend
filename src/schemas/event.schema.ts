import { z } from "zod";

// Schema for creating events
export const createEventSchema = z.object({
    body: z.object({
        title: z.string().min(1, "Título é obrigatório"),
        description: z.string().optional(),
        startDate: z.string().datetime().or(z.string().min(1)),
        endDate: z.string().datetime().optional().nullable(),
        location: z.string().optional(),
        address: z.string().optional(),
        coverImageUrl: z.string().url().optional().nullable(),
        capacity: z.number().int().positive().optional().nullable(),
        price: z.number().nonnegative().optional().nullable(),
        requiresRegistration: z.boolean().optional(),
        categoryId: z.string().uuid().optional().nullable()
    })
});

export const updateEventSchema = z.object({
    params: z.object({
        id: z.string().uuid("ID inválido")
    }),
    body: createEventSchema.shape.body.partial()
});

// Schema for event check-in
export const checkInSchema = z.object({
    body: z.object({
        eventId: z.string().uuid("ID do evento inválido"),
        visitorId: z.string().uuid().optional(),
        code: z.string().optional()
    })
});

// Schema for event registration
export const registerForEventSchema = z.object({
    params: z.object({
        id: z.string().uuid("ID do evento inválido")
    }),
    body: z.object({
        email: z.string().email().optional(),
        phone: z.string().optional(),
        notes: z.string().optional()
    }).optional()
});
