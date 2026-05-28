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
const modifiedUrl = DB_URL;

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
    const poolerUrl = await resolveBestUrl();
    const urlObj = new URL(poolerUrl);
    
    // Create a DIRECT version for DB Push (Prisma REQUIRES Session Mode/Direct for schema changes)
    const directUrl = new URL(poolerUrl);
    directUrl.port = '5432';
    directUrl.searchParams.delete('pgbouncer');
    const finalDirectUrl = directUrl.toString();

    console.log(`🔍 App URL: ${maskUrl(poolerUrl)}`);
    console.log(`🛠️ Migration URL: ${maskUrl(finalDirectUrl)}`);
    
    // -------------------------------------------------------------------------
    // SCHEMA SYNC:
    // -------------------------------------------------------------------------
    // 1. Sincronizar banco de dados (prisma db push)
    console.log("🛠️ Sincronizando esquema do banco de dados...");
    let migrationSuccess = false;

    try {
      console.log("📡 Tentando Migração via URL Direta (Porta 5432)...");
      execSync("npx prisma migrate deploy", { 
        env: { ...process.env, DATABASE_URL: finalDirectUrl },
        stdio: "inherit",
        timeout: 90000 
      });
      migrationSuccess = true;
      console.log("✅ Migração concluída via URL Direta.");
    } catch (error) {
      console.warn("⚠️ Falha na URL Direta. Tentando via URL de Conexão Principal...");
      try {
        execSync("npx prisma migrate deploy", { 
          env: { ...process.env, DATABASE_URL: poolerUrl },
          stdio: "inherit",
          timeout: 90000 
        });
        migrationSuccess = true;
        console.log("✅ Migração concluída via URL Principal.");
      } catch (error2) {
        console.error("❌ ERRO CRÍTICO: Não foi possível aplicar migrações no banco de dados.");
        console.error("Erro Direto:", error.message);
        console.error("Erro Principal:", error2.message);
      }
    }

    // 2. Garantir usuário Master (Rescue)
    console.log("👤 Garantindo usuário Master (Rescue)...");
    try {
      // Usamos node direto no arquivo compilado se disponível, ou ts-node com limite de memória
      execSync("node scripts/rescue_master.js", { 
        env: { ...process.env, DATABASE_URL: poolerUrl },
        stdio: "inherit",
        timeout: 60000
      });
    } catch (error) {
      console.log("⚠️ Erro ao executar rescue_master, mas continuando...");
      console.error(error);
    }

    console.log("🚀 [Render-Boost] Iniciando servidor...");
    process.env.DATABASE_URL = poolerUrl;
    
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
