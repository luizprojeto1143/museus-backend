import "dotenv/config";
import { S3Client, ListBucketsCommand, PutObjectCommand } from "@aws-sdk/client-s3";

async function checkR2() {
    console.log("--- Checking R2 Configuration ---");

    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKey = process.env.R2_ACCESS_KEY_ID;
    const secretKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucket = process.env.R2_BUCKET_NAME;

    console.log("R2_ACCOUNT_ID:", accountId ? "Set" : "Missing");
    console.log("R2_ACCESS_KEY_ID:", accessKey ? "Set" : "Missing");
    console.log("R2_SECRET_ACCESS_KEY:", secretKey ? "Set" : "Missing");
    console.log("R2_BUCKET_NAME:", bucket ? "Set" : "Missing");

    if (!accountId || !accessKey || !secretKey || !bucket) {
        console.error("❌ Missing R2 Environment Variables. Uploads will try local filesystem.");
        return;
    }

    const client = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: accessKey,
            secretAccessKey: secretKey
        }
    });

    try {
        console.log("🔄 Attempting to list buckets...");
        const data = await client.send(new ListBucketsCommand({}));
        console.log("✅ Connection Successful! Buckets found:", data.Buckets?.length);

        console.log(`🔄 Attempting small upload test to ${bucket}...`);
        await client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: "test-connectivity.txt",
            Body: "Hello Connection"
        }));
        console.log("✅ Upload Test Successful!");

    } catch (err: unknown) {
        if (err instanceof Error) {
            console.error("❌ R2 Connection Failed:", err.message);
            const errorObj = err as any;
            if (errorObj.name === "NetworkingError" || errorObj.code === "ECONNREFUSED") {
                console.error("   -> Network/Firewall issue or wrong Endpoint.");
            }
        } else {
            console.error("❌ R2 Connection Failed:", String(err));
        }
    }
}

checkR2();
