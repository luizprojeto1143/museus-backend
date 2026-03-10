import dns from 'dns';
import net from 'net';

const hosts = [
    'db.qyzvgplfussxtzfbwuyi.supabase.co',
    'aws-1-us-east-1.pooler.supabase.com'
];

async function checkHost(host) {
    console.log(`\n--- Checando: ${host} ---`);

    // 1. Resolução DNS
    try {
        const addresses = await dns.promises.resolve4(host);
        console.log(`IPv4: ${addresses.join(', ')}`);
    } catch (e) {
        console.log(`Falha ao resolver IPv4: ${e.message}`);
    }

    try {
        const addresses = await dns.promises.resolve6(host);
        console.log(`IPv6: ${addresses.join(', ')}`);
    } catch (e) {
        console.log(`Falha ao resolver IPv6: ${e.message}`);
    }

    // 2. Teste de Porta
    const ports = [5432, 6543];
    for (const port of ports) {
        const promise = new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(5000);
            socket.on('connect', () => {
                console.log(`✅ Porta ${port} aberta!`);
                socket.destroy();
                resolve(true);
            });
            socket.on('timeout', () => {
                console.log(`❌ Porta ${port} timeout.`);
                socket.destroy();
                resolve(false);
            });
            socket.on('error', (e) => {
                console.log(`❌ Porta ${port} erro: ${e.message}`);
                socket.destroy();
                resolve(false);
            });
            socket.connect(port, host);
        });
        await promise;
    }
}

async function start() {
    for (const host of hosts) {
        await checkHost(host);
    }
}

start();
