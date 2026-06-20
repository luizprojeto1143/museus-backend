import { Router } from "express";
import { prisma } from "../../prisma.js";

const router = Router();

// Publicly accessible passport via UUID
router.get("/passport/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const visitor = await prisma.visitor.findUnique({
            where: { id },
            include: {
                visitorRPGs: {
                    where: { isActive: true },
                    include: {
                        characterBase: true,
                        skin: true
                    }
                },
                visitorSkins: {
                    include: { skin: true }
                },
                passportStamps: {
                    include: {
                        work: {
                            select: {
                                id: true,
                                title: true,
                                imageUrl: true
                            }
                        }
                    }
                }
            }
        });

        if (!visitor) {
            return res.status(404).json({ error: "Passaporte não encontrado" });
        }

        res.json(visitor);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao buscar passaporte" });
    }
});

export default router;
