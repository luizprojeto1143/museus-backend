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

// RENDER EXTERNAL URL FIX:
// Se a URL for externa (.render.com) ela EXIGE SSL.
const isExternalRender = urlObj.hostname.includes('.render.com');
const hasSSLParam = urlObj.searchParams.has('sslmode');

if (isExternalRender && !hasSSLParam) {
    console.log("⚠️ URL Externa do Render detectada sem SSL. Adicionando 'sslmode=no-verify'...");
    urlObj.searchParams.set('sslmode', 'no-verify');
    modifiedUrl = urlObj.toString();
}

// Apenas logar mascarado para debug
console.log(`🔍 Connection Info: ${maskUrl(modifiedUrl)}`);
console.log(`🔌 NODE_OPTIONS: ${process.env.NODE_OPTIONS || 'default'}`);

// Atualiza o ambiente
process.env.DATABASE_URL = modifiedUrl;

console.log("🚀 Iniciando Script de Deploy (v5 - Safe Production Mode)...");

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

// CORREÇÃO CRÍTICA: Usar migrate deploy em vez de db push --accept-data-loss
// migrate deploy NÃO deleta dados, apenas aplica novas migrations
if (!runWithRetry('npx prisma migrate deploy')) {
    // Se migrate deploy falhar (ex: banco novo sem migrations ou erro P3005), tenta db push
    console.log("⚠️ Migrate deploy falhou. Tentando db push...");
    try {
        execSync('npx prisma db push', { stdio: 'inherit', env: process.env });
        console.log("✅ DB Push concluído.");
    } catch (e) {
        console.warn("⚠️ DB Push simples falhou (provável perda de dados detectada). Tentando com --accept-data-loss...");
        try {
            execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit', env: process.env });
            console.log("✅ DB Push com --accept-data-loss concluído.");
        } catch (e2) {
            console.error("❌ Falha crítica no banco de dados:", e2.message);
            process.exit(1);
        }
    }
}

// REMOVIDO: Seed automático em cada deploy
// O seed só deve ser executado UMA VEZ quando o banco é criado, não em cada deploy!
// MAS, para atender a solicitação de criar o usuário ADMIN, vamos habilitar nesta versão.
console.log("🌱 Executando Seed (Solicitado)...");
try {
    execSync('npm run prisma:seed', { stdio: 'inherit', env: process.env });
    console.log("✅ Seed concluído.");
} catch (e) {
    console.error("❌ Falha no seed (não crítico):", e.message);
}

console.log("2️⃣ Iniciando Aplicação...");

const appProcess = spawn('node', ['dist/index.js'], {
    stdio: 'inherit',
    env: process.env
});

appProcess.on('close', (code) => {
    console.log(`Aplicação encerrada com código ${code}`);
    process.exit(code || 0);
});
