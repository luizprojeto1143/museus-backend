import axios from 'axios';

async function test() {
    console.log("🔐 Logging in to production...");
    try {
        const loginRes = await axios.post('https://museus-backend-1.onrender.com/auth/login', {
            email: 'demo@museu.com',
            password: 'admin' // Tentativa baseada em nomes comuns, se falhar eu uso o que o usuário me der
        });

        const token = loginRes.data.token;
        console.log("✅ Logged in! Fetching dashboard...");

        const tenantId = '8cc9b546-7f7d-4908-a6cf-acdd7b86982b';
        const dashRes = await axios.get(`https://museus-backend-1.onrender.com/analytics/dashboard/${tenantId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log("📊 Dashboard results:", JSON.stringify(dashRes.data, null, 2).substring(0, 500) + "...");
    } catch (e) {
        if (e.response) {
            console.error("❌ Error Status:", e.response.status);
            console.error("❌ Error Data:", JSON.stringify(e.response.data, null, 2));
        } else {
            console.error("❌ Error:", e.message);
        }
    }
}

test();
