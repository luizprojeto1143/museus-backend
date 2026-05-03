import { Router } from "express";
import { authMiddleware as authenticate } from "../middleware/auth.js";

const router = Router();

// Proxy para OpenRouteService - evita expor API key no frontend
router.post("/directions", authenticate, async (req, res) => {
    try {
        const { start, end, profile } = req.body;

        // Validação
        if (!start || !end) {
            return res.status(400).json({ message: "start e end são obrigatórios" });
        }

        // start e end devem ser [longitude, latitude]
        const startCoords = Array.isArray(start) ? start : [start.lng, start.lat];
        const endCoords = Array.isArray(end) ? end : [end.lng, end.lat];

        // Profile: foot-walking, driving-car, cycling-regular
        const routeProfile = profile || "foot-walking";

        const apiKey = process.env.OPENROUTE_API_KEY;

        if (!apiKey) {
            // Se não tem API key, retorna rota direta (linha reta)
            console.warn("OPENROUTE_API_KEY não configurada, retornando rota direta");
            return res.json({
                type: "direct",
                distance: calculateDistance(startCoords[1], startCoords[0], endCoords[1], endCoords[0]),
                duration: 0,
                geometry: {
                    type: "LineString",
                    coordinates: [startCoords, endCoords]
                },
                steps: [{
                    instruction: "Siga em direção ao destino",
                    distance: 0,
                    duration: 0
                }]
            });
        }

        // Chamar OpenRouteService
        const url = `https://api.openrouteservice.org/v2/directions/${routeProfile}`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": apiKey
            },
            body: JSON.stringify({
                coordinates: [startCoords, endCoords],
                instructions: true,
                language: "pt"
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("OpenRouteService error:", errorText);
            throw new Error("Erro ao calcular rota");
        }

        const data = await response.json();

        // Formatar resposta
        const route = data.routes?.[0];
        if (!route) {
            throw new Error("Nenhuma rota encontrada");
        }

        return res.json({
            type: "route",
            distance: route.summary.distance, // em metros
            duration: route.summary.duration, // em segundos
            geometry: route.geometry,
            steps: route.segments?.[0]?.steps?.map((step: any) => ({
                instruction: step.instruction,
                distance: step.distance,
                duration: step.duration,
                type: step.type,
                name: step.name
            })) || []
        });

    } catch (err: any) {
        console.error("Erro ao calcular direções:", err);
        return res.status(500).json({
            message: "Erro ao calcular rota",
            error: err.message
        });
    }
});

// Função auxiliar para calcular distância em metros (Haversine)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // raio da Terra em metros
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

export default router;
