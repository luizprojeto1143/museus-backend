import "dotenv/config";

const publicUrl = process.env.R2_PUBLIC_BASE_URL;
if (!publicUrl) {
    console.log("R2_PUBLIC_BASE_URL is NOT set.");
} else {
    console.log("R2_PUBLIC_BASE_URL value:", publicUrl);
    if (!publicUrl.startsWith("http")) {
        console.log("❌ WARNING: URL does not start with http/https. This will cause relative path issues in the frontend.");
    } else {
        console.log("✅ URL format looks correct (starts with http).");
    }
}
