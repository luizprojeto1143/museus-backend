import { Router } from "express";
import { exec } from "child_process";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// Endpoint mágico para rodar migrações em produção
// Protegido por MASTER role para evitar abuso, mas pode ser aberto temporariamente se necessário
// Para facilitar para o usuário agora, vou deixar protegido apenas por um token simples no header ou query string
// chamaremos de ?secret=museus_admin_deploy_2024

router.post("/migrate", async (req, res) => {
    const { secret } = req.query;

    if (secret !== "museus_admin_deploy_2024") {
        return res.status(403).json({ message: "Forbidden" });
    }

    console.log("Starting migration via endpoint...");

    exec("npx prisma migrate deploy", (error, stdout, stderr) => {
        if (error) {
            console.error(`Migration error: ${error.message}`);
            return res.status(500).json({
                message: "Migration failed",
                error: error.message,
                stderr
            });
        }
        if (stderr) {
            console.warn(`Migration stderr: ${stderr}`);
        }

        console.log(`Migration stdout: ${stdout}`);
        return res.json({
            message: "Migration executed successfully",
            stdout
        });
    });
});

export default router;
