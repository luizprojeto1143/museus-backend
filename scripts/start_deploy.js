import { execSync, spawn } from 'child_process';
import 'dotenv/config';


// 1. Configurar preferência por IPv4
// Isso corrige problemas de resolução DNS comuns em ambientes Node > 17 (especialmente com Render + Postgres)
process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ' --dns-result-order=ipv4first';

const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
    console.error("❌ Erro: DATABASE_URL não está definida.");
    process.exit(1);
}

// Logging seguro
function maskUrl(url) {
    try {
        const urlObj = new URL(url);
        urlObj.password = '****';
        return `Protocol: ${urlObj.protocol}, Host: ${urlObj.hostname}, Port: ${urlObj.port || 'default'}, Params: ${urlObj.search}`;
    } catch (e) {
        return 'Invalid URL';
    }
}

const urlObj = new URL(DB_URL);
let modifiedUrl = DB_URL;

// RENDER SSL & TIMEOUT FIX:
const hasSSLParam = urlObj.searchParams.has('sslmode');
const hasTimeout = urlObj.searchParams.has('connect_timeout');
const hasPoolTimeout = urlObj.searchParams.has('pool_timeout');
const hasConnLimit = urlObj.searchParams.has('connection_limit');

if (!hasSSLParam) {
    console.log("ℹ️ SSL: Adicionando 'sslmode=require'...");
    urlObj.searchParams.set('sslmode', 'require');
}

if (!hasTimeout) {
    urlObj.searchParams.set('connect_timeout', '60');
}

// Otimização para connection pooler do Supabase no Render
if (!hasPoolTimeout) {
    urlObj.searchParams.set('pool_timeout', '60');
}

if (!hasConnLimit) {
    urlObj.searchParams.set('connection_limit', '10');
}

// -------------------------------------------------------------------------
// SMART FALLBACK LOGIC:
// -------------------------------------------------------------------------
const isSupabasePooler = urlObj.hostname.includes('pooler.supabase.com');

async function resolveBestUrl() {
    console.log("🛠️ Analisando DATABASE_URL e testando conectividade...");
    
    let urlToProcess = DB_URL;
    if (urlToProcess.includes('+') && !urlToProcess.includes('%2B')) {
        urlToProcess = urlToProcess.replace(/\+/, '%2B');
    }

    const finalUrl = new URL(urlToProcess);
    const host = finalUrl.hostname;
    const originalPort = finalUrl.port || '5432';

    // Testar se a porta 6543 está aberta (Pooler)
    console.log(`📡 Testando porta 6543 em ${host}...`);
    const is6543Open = await testConnectivity(host, 6543);
    
    if (is6543Open) {
        console.log("✅ Porta 6543 (Pooler) está acessível. Usando Modo Transactional.");
        finalUrl.port = '6543';
        finalUrl.searchParams.set('pgbouncer', 'true');
    } else {
        console.log("📡 Testando porta 5432 em " + host + "...");
        const is5432Open = await testConnectivity(host, 5432);
        
        if (is5432Open) {
            console.log("✅ Porta 5432 está acessível.");
            finalUrl.port = '5432';
        } else {
            console.log("⚠️ Ambas as portas (6543, 5432) falharam no teste rápido. Mantendo porta original: " + originalPort);
            finalUrl.port = originalPort;
        }
        
        // Se o host é um pooler, tentamos pgbouncer independentemente da porta se estivermos forçados a ele
        if (host.includes('pooler.supabase.com')) {
            finalUrl.searchParams.set('pgbouncer', 'true');
        }
    }

    finalUrl.searchParams.set('sslmode', 'require');
    finalUrl.searchParams.set('connect_timeout', '30');
    finalUrl.searchParams.set('pool_timeout', '90');
    finalUrl.searchParams.set('connection_limit', '2'); // Safe for transaction pooler
    
    const preparedUrl = finalUrl.toString();
    const masked = preparedUrl.replace(/:[^:@]+@/, ":****@");
    console.log(`🚀 URL Preparada: ${masked}`);
    
    return preparedUrl;
}

import { Socket } from 'net';
function testConnectivity(host, port) {
    return new Promise((resolve) => {
        const socket = new Socket();
        const timeout = 5000; // Increased to 5s for slower network environments like Render
        socket.setTimeout(timeout);
        socket.on('connect', () => { socket.destroy(); resolve(true); });
        socket.on('timeout', () => { socket.destroy(); resolve(false); });
        socket.on('error', () => { socket.destroy(); resolve(false); });
        socket.connect(port, host);
    });
}

async function main() {
    const finalUrl = await resolveBestUrl();
    process.env.DATABASE_URL = finalUrl;
    console.log(`🔍 URL Final Preparada: ${maskUrl(finalUrl)}`);
    
    // -------------------------------------------------------------------------
    // SCHEMA SYNC:
    // -------------------------------------------------------------------------
    try {
        console.log("🛠️ Sincronizando schema do banco de dados (Prisma DB Push)...");
        execSync('npx prisma db push --accept-data-loss', { 
            stdio: 'inherit',
            env: { ...process.env, DATABASE_URL: finalUrl }
        });
        console.log("✅ Schema sincronizado com sucesso.");
    } catch (dbErr) {
        console.error("⚠️ Falha na sincronização do banco (não fatal):", dbErr.message);
    }

    console.log("🚀 [Render-Boost] Boot imediato...");
    
    const appProcess = spawn('node', ['dist/index.js'], {
        stdio: 'inherit',
        env: process.env
    });

    appProcess.on('close', (code) => {
        console.log(`Aplicação encerrada com código ${code}`);
        process.exit(code || 0);
    });
}

main().catch(err => {
    console.error("❌ Erro no script de deploy:", err);
    process.exit(1);
});
