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
    // Aumentado de 5 para 10 para evitar timeouts em picos
    urlObj.searchParams.set('connection_limit', '10');
}

// Usar Session Mode (Porta 5432) no host do pooler para evitar problemas de IPv6/PgBouncer
// No modo session do Supabase (5432), não precisamos de ?pgbouncer=true para o Prisma
if (urlObj.hostname.includes('pooler.supabase.com')) {
    urlObj.searchParams.delete('pgbouncer');
}

// Forçar porta 5432 se for o host do pooler e porta 6543 estiver falhando
if (urlObj.hostname.includes('pooler.supabase.com') && urlObj.port === '6543') {
    console.log("ℹ️ Rede: Trocando porta 6543 por 5432 para evitar bloqueios de firewall...");
    urlObj.port = '5432';
}

modifiedUrl = urlObj.toString();

// Apenas logar mascarado para debug
console.log(`🔍 Conexo: ${maskUrl(modifiedUrl)}`);
console.log(`🔌 NODE_OPTIONS: ${process.env.NODE_OPTIONS || 'padro'}`);

// Atualiza o ambiente
process.env.DATABASE_URL = modifiedUrl;

console.log("🚀 [Render-Boost] Iniciando Aplicação IMEDIATAMENTE...");

// INICIAR APP PRIMEIRO para o Render detectar a porta aberta
const appProcess = spawn('node', ['dist/index.js'], {
    stdio: 'inherit',
    env: process.env
});

console.log("📦 [Async] Iniciando Migrações em Segundo Plano...");

// Função para tentar executar comando com retries
function runWithRetry(command, retries = 5, delayMs = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`1️⃣ Executando Migrate Deploy (Tentativa ${i + 1}/${retries})...`);
            execSync(command, { stdio: 'inherit', env: process.env });
            console.log("✅ Migrate Deploy concluído com sucesso.");
            return true;
        } catch (error) {
            console.error(`❌ Falha na tentativa ${i + 1}: ${error.message}`);
            if (i < retries - 1) {
                console.log(`⏳ Aguardando ${delayMs}ms antes de tentar novamente...`);
                const start = Date.now();
                while (Date.now() - start < delayMs) { /* busy wait */ }
            } else {
                console.error("❌ Todas as tentativas de migração falharam.");
                return false;
            }
        }
    }
}

// Função para migração segura (não bloqueia o loop)
async function startMigrations() {
    console.log("🛠️ Verificando esquema do banco...");
    if (!runWithRetry('npx prisma migrate deploy', 3, 10000)) {
        console.log("⚠️ Migrate falhou, tentando db push...");
        try {
            execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit', env: process.env });
            console.log("✅ Banco sincronizado via push.");
        } catch (e) {
            console.error("❌ Erro fatal no banco:", e.message);
        }
    } else {
        console.log("✅ Migrações aplicadas.");
    }
}

// Rodar sem bloquear
startMigrations().catch(err => console.error("❌ Erro nas migrações:", err));

appProcess.on('close', (code) => {
    console.log(`Aplicação encerrada com código ${code}`);
    process.exit(code || 0);
});
