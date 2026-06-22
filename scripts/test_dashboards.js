import axios from 'axios';

async function testEndpoint(name, url, token) {
    console.log(`📡 Testing ${name}: ${url}...`);
    try {
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log(`✅ ${name} SUCCESS!`);
        console.log(`📡 CORS Header: ${response.headers['access-control-allow-origin'] || 'MISSING'}`);
    } catch (e) {
        console.error(`❌ ${name} FAILED.`);
        if (e.response) {
            console.error("Status:", e.response.status);
            console.error("Headers:", JSON.stringify(e.response.headers, null, 2));
            console.error("Data:", JSON.stringify(e.response.data, null, 2));
        } else {
            console.error("Message:", e.message);
        }
    }
}

async function run() {
    if (process.env.NODE_ENV === "production") {
        console.error("❌ Operação abortada: Scripts de teste/demo são bloqueados em produção por motivos de segurança.");
        process.exit(1);
    }
    const baseUrl = "https://museus-backend-1.onrender.com";
    const tenantId = "8cc9b546-7f7d-4908-a6cf-acdd7b86982b";
    
    // 1. Login to get fresh token
    console.log("🔑 Logging in...");
    const loginRes = await axios.post(`${baseUrl}/auth/login`, {
        email: "demo@museu.com",
        password: "123456"
    });
    const token = loginRes.data.accessToken;
    console.log("✅ Token acquired.");

    // 2. Test failing endpoints
    await testEndpoint("Analytics", `${baseUrl}/analytics/dashboard/${tenantId}`, token);
    await testEndpoint("Visitor Summary", `${baseUrl}/visitors/me/summary?email=demo@museu.com&tenantId=${tenantId}`, token);
    await testEndpoint("Tenant Settings", `${baseUrl}/tenants/${tenantId}/settings`, token);
}

run();
