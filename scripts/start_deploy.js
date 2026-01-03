import { execSync, spawn } from 'child_process';

// 1. Configurar preferência por IPv4 antes de qualquer outra coisa
// Isso corrige problemas de resolução DNS comuns em ambientes Node > 17
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

let modifiedUrl = DB_URL;

// Tenta limpar params conflitantes da tentativa anterior se existirem hardcoded na URL base do Render
// (Mas geralmente a variável vem limpa a cada deploy limpo, vamos apenas garantir o SSL no-verify)
if (modifiedUrl.includes('sslmode=require')) {
    modifiedUrl = modifiedUrl.replace('sslmode=require', 'sslmode=no-verify');
}

const paramsToAdd = [];

if (!modifiedUrl.includes('sslmode=')) {
    console.log("⚠️ Injetando 'sslmode=no-verify' (Padrão para Render Int)...");
    paramsToAdd.push('sslmode=no-verify');
}

// Reduzir connection limit para migração para evitar gargalo
if (!modifiedUrl.includes('connection_limit=')) {
    paramsToAdd.push('connection_limit=3');
}

if (paramsToAdd.length > 0) {
    const separator = modifiedUrl.includes('?') ? '&' : '?';
    modifiedUrl = `${modifiedUrl}${separator}${paramsToAdd.join('&')}`;
}

console.log(`🔍 Connection Info: ${maskUrl(modifiedUrl)}`);
console.log(`🔌 NODE_OPTIONS: ${process.env.NODE_OPTIONS}`);

// Atualiza o ambiente
process.env.DATABASE_URL = modifiedUrl;

console.log("🚀 Iniciando Script de Deploy (v3 - IPv4 First + no-verify)...");

// Função para tentar executar comando com retries
function runWithRetry(command, retries = 3, delayMs = 3000) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`1️⃣ Executando Migrações (Tentativa ${i + 1}/${retries})...`);
            execSync(command, { stdio: 'inherit', env: process.env });
            console.log("✅ Migrações concluídas com sucesso.");
            return true;
        } catch (error) {
            console.error(`❌ Falha na tentativa ${i + 1}: ${error.message}`);
            if (i < retries - 1) {
                console.log(`⏳ Aguardando ${delayMs}ms antes de tentar novamente...`);
                const start = Date.now();
                while (Date.now() - start < delayMs) { } // Busy wait
            } else {
                console.error("❌ Todas as tentativas de migração falharam.");
                return false;
            }
        }
    }
}

if (!runWithRetry('npx prisma migrate deploy')) {
    process.exit(1);
}

// Executar Seed automaticamente se o comando existir
console.log("🌱 Executando Seeding (Populando dados iniciais)...");
try {
    // Executa de forma síncrona. Ignora erro se falhar para não travar deploy.
    execSync('npm run prisma:seed', { stdio: 'inherit', env: process.env });
    console.log("✅ Seed concluído.");
} catch (e) {
    console.warn("⚠️ Aviso: Seed falhou ou já foi executado. Continuando...", e.message);
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
