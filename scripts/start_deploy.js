import { execSync, spawn } from 'child_process';

const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
    console.error("❌ Erro: DATABASE_URL não está definida.");
    process.exit(1);
}

// Function to mask URL for safe logging but showing PORT
function maskUrl(url) {
    try {
        const urlObj = new URL(url);
        urlObj.password = '****';
        return `Protocol: ${urlObj.protocol}, Host: ${urlObj.hostname}, Port: ${urlObj.port}, Params: ${urlObj.search}`;
    } catch (e) {
        return 'Invalid URL';
    }
}

let modifiedUrl = DB_URL;

// Tenta forçar sslmode=require e aumentar timeout
const paramsToAdd = [];

if (!DB_URL.includes('sslmode=')) {
    console.log("⚠️ Injetando 'sslmode=require' (tentativa de fix para P1017)...");
    paramsToAdd.push('sslmode=require');
}

if (!DB_URL.includes('connect_timeout=')) {
    console.log("⚠️ Injetando 'connect_timeout=30'...");
    paramsToAdd.push('connect_timeout=30');
}

if (paramsToAdd.length > 0) {
    const separator = modifiedUrl.includes('?') ? '&' : '?';
    modifiedUrl = `${modifiedUrl}${separator}${paramsToAdd.join('&')}`;
}

console.log(`🔍 Detalhes da Conexão: ${maskUrl(modifiedUrl)}`);

// Atualiza o ambiente
process.env.DATABASE_URL = modifiedUrl;

console.log("🚀 Iniciando Script de Deploy (v2 - Require SSL + Timeout)...");

// Função para tentar executar comando com retries
function runWithRetry(command, retries = 3, delayMs = 3000) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`1️⃣ Executando Migrações (Tentativa ${i + 1}/${retries})...`);
            // check if we are using pgBouncer (port 6432 typically)
            // If port is 6432, migrations might fail if not using direct url, but let's try anyway.

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

console.log("2️⃣ Iniciando Aplicação (node dist/index.js)...");

const appProcess = spawn('node', ['dist/index.js'], {
    stdio: 'inherit',
    env: process.env
});

appProcess.on('close', (code) => {
    console.log(`Aplicação encerrada com código ${code}`);
    process.exit(code || 0);
});
