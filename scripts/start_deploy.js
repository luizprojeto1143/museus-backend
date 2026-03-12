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

async function tryConnect(urlStr) {
    const testUrl = new URL(urlStr);
    const host = testUrl.hostname;
    const port = parseInt(testUrl.port || '5432');
    
    console.log(`📡 Testando conexo TCP com ${host}:${port}...`);
    const success = await testConnectivity(host, port);
    
    if (success) {
        console.log(`✅ Conexo TCP confirmada para ${host}:${port}`);
        return true;
    }
    return false;
}

async function resolveBestUrl() {
    console.log("🛠️  Resolvendo melhor URL de banco...");
    
    // 1. Se for Supabase Pooler, PRIORIZAR 6543 (Transaction Mode) - provado alcanável em testes
    if (isSupabasePooler) {
        console.log("💎 Supabase Pooler detectado. Usando porta 6543 (Transaction Mode).");
        const transactionUrl = new URL(urlObj.toString());
        transactionUrl.port = '6543';
        transactionUrl.searchParams.set('pgbouncer', 'true');
        return transactionUrl.toString();
    }

    // 2. Tentar a URL original (geralmente 5432)
    console.log(`📡 Testando porta padrão ${urlObj.port || '5432'}...`);
    if (await tryConnect(urlObj.toString())) {
        console.log("✅ Conexão via porta padrão confirmada.");
        return urlObj.toString();
    }

    // 3. Fallback final: Tentar sem pgbouncer
    console.log("⚠️ Tentando conexão limpa (sem pgbouncer)...");
    const cleanUrl = new URL(urlObj.toString());
    cleanUrl.searchParams.delete('pgbouncer');
    if (await tryConnect(cleanUrl.toString())) {
        console.log("✅ Conexão limpa bem-sucedida.");
        return cleanUrl.toString();
    }

    console.warn("❌ Nenhuma URL respondeu ao teste TCP. Usando a URL original.");
    return urlObj.toString(); 
}

import { Socket } from 'net';
function testConnectivity(host, port) {
    return new Promise((resolve) => {
        const socket = new Socket();
        const timeout = 3000; // 3s para teste rpido
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
