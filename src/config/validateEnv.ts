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
    const isRealProduction = process.env.APP_ENV === "production";

    for (const varName of REQUIRED_ENV_VARS) {
        if (!process.env[varName]) {
            missing.push(varName);
        }
    }

    // In production, require all critical variables
    if (isProduction) {
        const prodRequiredAlways = [
            "REFRESH_SECRET",
            "COOKIE_SECRET",
            "GAME_SECRET",
            "FRONTEND_URL",
            "REDIS_URL"
        ];
        
        for (const varName of prodRequiredAlways) {
            if (!process.env[varName]) {
                missing.push(varName);
            }
        }

        // Storage check: S3 or R2 must be configured
        const r2Ok = process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME;
        const s3Ok = process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY && process.env.S3_BUCKET;
        if (!r2Ok && !s3Ok) {
            missing.push("Storage Credentials (R2 or S3 keys)");
        }

        // OpenAI check
        if (!process.env.OPENAI_API_KEY) {
            missing.push("OPENAI_API_KEY");
        }

        const billingMode = process.env.BILLING_MODE || (process.env.PAYMENTS_DISABLED === "true" ? "disabled" : "live");
        const paymentsDisabled = billingMode === "disabled";
        
        if (isRealProduction && paymentsDisabled) {
            console.error("❌ CRITICAL: Payments cannot be disabled in real production (APP_ENV=production).");
            process.exit(1);
        }
        
        if (!paymentsDisabled) {
            const stripeRequired = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_SPONSOR_WEBHOOK_SECRET"];
            for (const varName of stripeRequired) {
                if (!process.env[varName]) {
                    missing.push(varName);
                }
            }
        } else {
            console.log(`ℹ️ Billing/Stripe is set to "${billingMode}". Skipping boot checks for Stripe keys.`);
        }

        // Secret strength validation in production
        const jwtSecret = process.env.JWT_SECRET!;
        if (jwtSecret && jwtSecret.length < 32) {
            console.error("❌ CRITICAL: JWT_SECRET must be at least 32 characters in production.");
            process.exit(1);
        }

        const gameSecret = process.env.GAME_SECRET;
        if (gameSecret && gameSecret.length < 32) {
            console.error("❌ CRITICAL: GAME_SECRET must be at least 32 characters in production.");
            process.exit(1);
        }
    }

    if (missing.length > 0) {
        console.error("❌ CRITICAL: Missing required environment variables:");
        missing.forEach(v => console.error(`   - ${v}`));
        console.error("\nThe application cannot start without these variables.");
        console.error("Please set them in your .env file or environment.");
        process.exit(1);
    }

    // Log optional vars status in development
    if (!isProduction) {
        const configured = OPTIONAL_ENV_VARS.filter(v => process.env[v]);
        console.log(`✅ Environment validated. ${configured.length}/${OPTIONAL_ENV_VARS.length} optional vars configured.`);
    }
}
