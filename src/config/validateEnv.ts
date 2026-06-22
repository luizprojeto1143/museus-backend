/**
 * Validates critical environment variables on application boot
 * App will fail to start if any required variable is missing
 */

const REQUIRED_ENV_VARS = [
    "DATABASE_URL",
    "JWT_SECRET"
];

const OPTIONAL_ENV_VARS = [
    "FRONTEND_URL",
    "PORT",
    "NODE_ENV",
    "OPENAI_API_KEY",
    "RESEND_API_KEY",
    "S3_BUCKET",
    "S3_REGION",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY"
];

// Variables that are recommended in production but optional in development
const PRODUCTION_RECOMMENDED_ENV_VARS = [
    "FRONTEND_URL",
    "GAME_SECRET",
    "ASAAS_API_KEY",
    "STRIPE_SECRET_KEY"
];

export function validateEnv(): void {
    const missing: string[] = [];
    const isProduction = process.env.NODE_ENV === "production";

    for (const varName of REQUIRED_ENV_VARS) {
        if (!process.env[varName]) {
            missing.push(varName);
        }
    }

    // In production, log warning if these variables are missing instead of crashing
    if (isProduction) {
        for (const varName of PRODUCTION_RECOMMENDED_ENV_VARS) {
            if (!process.env[varName]) {
                console.warn(`⚠️  WARNING: Production environment variable "${varName}" is missing. Some features/integrations will be disabled.`);
            }
        }
    }

    if (missing.length > 0) {
        console.error("❌ CRITICAL: Missing required environment variables:");
        missing.forEach(v => console.error(`   - ${v}`));
        console.error("\nThe application cannot start without these variables.");
        console.error("Please set them in your .env file or environment.");
        process.exit(1);
    }

    // Check JWT_SECRET strength
    const jwtSecret = process.env.JWT_SECRET!;
    if (jwtSecret.length < 32) {
        console.warn("⚠️  WARNING: JWT_SECRET is shorter than 32 characters. Consider using a stronger secret.");
    }

    // Check GAME_SECRET strength (if set)
    const gameSecret = process.env.GAME_SECRET;
    if (gameSecret && gameSecret.length < 32) {
        console.warn("⚠️  WARNING: GAME_SECRET is shorter than 32 characters. Consider using a stronger secret.");
    }

    // Log optional vars status (for debugging)
    if (!isProduction) {
        const configured = OPTIONAL_ENV_VARS.filter(v => process.env[v]);
        console.log(`✅ Environment validated. ${configured.length}/${OPTIONAL_ENV_VARS.length} optional vars configured.`);
    }
}
