async function test() {
    console.log("📡 Testing auth failure (non-existent user)...");
    const res = await fetch('https://museus-backend-1.onrender.com/auth/login', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Origin': 'https://culturaviva.vercel.app'
        },
        body: JSON.stringify({ email: 'non-existent@test.com', password: 'wrong' })
    });
    console.log(`Status: ${res.status}`);
    console.log(`CORS Header: ${res.headers.get('access-control-allow-origin')}`);
    const data = await res.json();
    console.log("Data:", JSON.stringify(data, null, 2));

    console.log("\n📡 Testing auth success (demo account) with CORS check...");
     const res2 = await fetch('https://museus-backend-1.onrender.com/auth/login', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Origin': 'https://culturaviva.vercel.app'
        },
        body: JSON.stringify({ email: 'demo@museu.com', password: 'demo' })
    });
    console.log(`Status: ${res2.status}`);
    console.log(`CORS Header: ${res2.headers.get('access-control-allow-origin')}`);
}

test().catch(console.error);
