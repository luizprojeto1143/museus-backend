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

export function validateEnv(): void {
    const missing: string[] = [];

    for (const varName of REQUIRED_ENV_VARS) {
        if (!process.env[varName]) {
            missing.push(varName);
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

    // Log optional vars status (for debugging)
    if (process.env.NODE_ENV !== "production") {
        const configured = OPTIONAL_ENV_VARS.filter(v => process.env[v]);
        console.log(`✅ Environment validated. ${configured.length}/${OPTIONAL_ENV_VARS.length} optional vars configured.`);
    }
}
