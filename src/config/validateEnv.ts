/**
 * Validates critical environment variables on application boot.
 * The API must fail fast when production dependencies are missing.
 */

const BASE_REQUIRED_ENV_VARS = [
    "DATABASE_URL",
    "JWT_SECRET"
];

const OPTIONAL_ENV_VARS = [
    "APP_ENV",
    "PORT",
    "NODE_ENV",
    "BILLING_MODE",
    "PAYMENTS_DISABLED",
    "OPENAI_MODEL",
    "RESEND_API_KEY",
    "ASAAS_API_KEY",
    "ASAAS_API_URL",
    "S3_BUCKET",
    "S3_REGION",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_BASE_URL",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASS",
    "MASTER_ALERT_EMAIL"
];

const PRODUCTION_ALWAYS_REQUIRED = [
    "APP_ENV",
    "REFRESH_SECRET",
    "COOKIE_SECRET",
    "GAME_SECRET",
    "FRONTEND_URL",
    "REDIS_URL",
    "OPENAI_API_KEY"
];

const STRIPE_REQUIRED = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_SPONSOR_WEBHOOK_SECRET"
];

const R2_REQUIRED = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_BASE_URL"
];

const S3_REQUIRED = [
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "S3_BUCKET"
];

function isPresent(varName: string): boolean {
    const value = process.env[varName];
    return typeof value === "string" && value.trim().length > 0;
}

function addMissing(missing: string[], varNames: string[]): void {
    for (const varName of varNames) {
        if (!isPresent(varName) && !missing.includes(varName)) {
            missing.push(varName);
        }
    }
}

function normalizeAppEnv(): void {
    const validAppEnvs = ["demo", "staging", "homologation", "production"];
    const appEnvRaw = process.env.APP_ENV;
    const appEnv = appEnvRaw ? appEnvRaw.toLowerCase().trim() : undefined;

    if (!appEnv || !validAppEnvs.includes(appEnv)) {
        console.error(`CRITICAL: APP_ENV must be one of ${validAppEnvs.join(" | ")} when NODE_ENV=production. Received: "${appEnvRaw}"`);
        process.exit(1);
    }

    process.env.APP_ENV = appEnv;
}

function assertSecretStrength(varName: string, minLength = 32): void {
    const value = process.env[varName];
    if (value && value.length < minLength) {
        console.error(`CRITICAL: ${varName} must be at least ${minLength} characters in production.`);
        process.exit(1);
    }
}

function assertUrl(varName: string): void {
    const value = process.env[varName];
    if (!value) {
        return;
    }

    try {
        const parsed = new URL(value);
        if (!["http:", "https:"].includes(parsed.protocol)) {
            throw new Error("Invalid protocol");
        }
    } catch {
        console.error(`CRITICAL: ${varName} must be a valid http(s) URL.`);
        process.exit(1);
    }
}

function assertLiveStripeKey(): void {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
        return;
    }

    if (key.includes("missing_key") || key === "sk_test_missing_key_please_configure_in_render_env_vars") {
        console.error("CRITICAL: STRIPE_SECRET_KEY is still using the development placeholder.");
        process.exit(1);
    }
}

export function validateEnv(): void {
    const missing: string[] = [];
    const isNodeProduction = process.env.NODE_ENV === "production";

    addMissing(missing, BASE_REQUIRED_ENV_VARS);

    if (isNodeProduction) {
        normalizeAppEnv();
        addMissing(missing, PRODUCTION_ALWAYS_REQUIRED);

        const appEnv = process.env.APP_ENV;
        const billingMode = process.env.BILLING_MODE || (process.env.PAYMENTS_DISABLED === "true" ? "disabled" : "live");
        const paymentsDisabled = billingMode === "disabled";

        if ((appEnv === "production" || appEnv === "homologation") && paymentsDisabled) {
            console.error(`CRITICAL: Payments cannot be disabled when APP_ENV=${appEnv}.`);
            process.exit(1);
        }

        if (!paymentsDisabled) {
            addMissing(missing, STRIPE_REQUIRED);
        } else {
            console.log(`INFO: Billing/Stripe is set to "${billingMode}". Skipping Stripe key boot checks.`);
        }

        const r2Configured = R2_REQUIRED.every(isPresent);
        const s3Configured = S3_REQUIRED.every(isPresent);
        if (!r2Configured && !s3Configured) {
            missing.push(`Storage credentials (${R2_REQUIRED.join(", ")} or ${S3_REQUIRED.join(", ")})`);
        }

        assertSecretStrength("JWT_SECRET");
        assertSecretStrength("REFRESH_SECRET");
        assertSecretStrength("COOKIE_SECRET");
        assertSecretStrength("GAME_SECRET");
        assertUrl("FRONTEND_URL");
        assertUrl("R2_PUBLIC_BASE_URL");
        assertLiveStripeKey();
    }

    if (missing.length > 0) {
        console.error("CRITICAL: Missing required environment variables:");
        missing.forEach(v => console.error(`   - ${v}`));
        console.error("\nThe application cannot start without these variables.");
        console.error("Set them in your .env file or deployment environment.");
        process.exit(1);
    }

    if (!isNodeProduction) {
        const configured = OPTIONAL_ENV_VARS.filter(isPresent);
        console.log(`Environment validated. ${configured.length}/${OPTIONAL_ENV_VARS.length} optional vars configured.`);
    }
}
