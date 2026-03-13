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
        categoryId: z.string().uuid().optional().nullable(),
        spaceId: z.string().uuid().optional().nullable(),

        // Workshop / Cultural Center
        type: z.enum(["WORKSHOP", "EXHIBITION", "SHOW", "LECTURE", "OTHER"]).optional(),
        instructor: z.string().optional(),
        materials: z.string().optional(),

        // Format & Visibility (Added to match controller)
        format: z.string().optional(),
        visibility: z.string().optional(),
        isOnline: z.boolean().optional(),
        meetingLink: z.string().optional(),
        platform: z.string().optional(),

        // Media
        audioUrl: z.string().optional(),
        videoUrl: z.string().optional(),

        // Location Details
        zipCode: z.string().optional(),
        number: z.string().optional(),
        complement: z.string().optional(),
        neighborhood: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),

        // Producer
        producerName: z.string().optional(),
        producerDescription: z.string().optional(),
        producerLogoUrl: z.string().optional(),

        // Certificate & Features
        certificateBackgroundUrl: z.string().optional(),
        certificateText: z.string().optional(),
        minMinutesForCertificate: z.number().optional().nullable(),
        certificateRequiresSurvey: z.boolean().optional(),
        customFormSchema: z.any().optional(),
        galleryUrls: z.any().optional(),
        equipamentoId: z.string().uuid().optional().nullable()
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
