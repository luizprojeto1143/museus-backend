import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import 'dotenv/config';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "TEMP_DEV_SECRET_DO_NOT_USE_IN_PROD";

async function testLoginSimulation(email, password) {
    console.log(`🧪 Simulating login for: ${email}`);
    try {
        // 1. Find user
        const user = await prisma.user.findUnique({
            where: { email },
            include: {
                tenant: { select: { type: true } }
            }
        });

        if (!user) {
            console.error("❌ User not found");
            return;
        }
        console.log("✅ User found");

        // 2. Bcrypt compare
        const ok = await bcrypt.compare(password, user.password);
        if (!ok) {
            console.error("❌ Invalid password");
            return;
        }
        console.log("✅ Password verified");

        // 3. Generate tokens
        console.log("🛠️ Generating tokens...");
        const accessToken = jwt.sign(
            { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId },
            JWT_SECRET,
            { subject: user.id, expiresIn: '15m' }
        );
        console.log("✅ Access token generated");

        const refreshTokenHash = crypto.randomBytes(40).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        // 4. Save Refresh Token
        console.log("💾 Saving refresh token to DB...");
        const rt = await prisma.refreshToken.create({
            data: {
                token: refreshTokenHash,
                userId: user.id,
                expiresAt: expiresAt
            }
        });
        console.log("✅ Refresh token saved to DB");

        // 5. Cleanup
        console.log("🧹 Cleaning up test token...");
        await prisma.refreshToken.delete({ where: { id: rt.id } });
        console.log("✅ Success! Simulation completed without errors.");

    } catch (e) {
        console.error("❌ Simulation FAILED:", e);
    } finally {
        await prisma.$disconnect();
    }
}

// Use credentials from seed
testLoginSimulation("demo@museu.com", "123456");
