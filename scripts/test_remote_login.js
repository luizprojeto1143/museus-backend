import axios from 'axios';

async function testRemoteLogin() {
    const url = "https://museus-backend-1.onrender.com/auth/login";
    const payload = {
        email: "demo@museu.com",
        password: "123456"
    };

    console.log(`📡 Sending POST to ${url}...`);
    try {
        const response = await axios.post(url, payload);
        console.log("✅ Remote login SUCCESS!");
        console.log("Status:", response.status);
        console.log("Data:", JSON.stringify(response.data, null, 2).substring(0, 200) + "...");
    } catch (e) {
        console.error("❌ Remote login FAILED.");
        if (e.response) {
            console.error("Status:", e.response.status);
            console.error("Data:", JSON.stringify(e.response.data, null, 2));
        } else {
            console.error("Message:", e.message);
        }
    }
}

testRemoteLogin();
