import { execSync, spawn } from 'child_process';

const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
    console.error("❌ Erro: DATABASE_URL não está definida.");
    process.exit(1);
}

// Function to mask URL for safe logging
function maskUrl(url) {
    try {
        const urlObj = new URL(url);
        urlObj.password = '****';
        return urlObj.toString();
    } catch (e) {
        return 'Invalid URL';
    }
}

let modifiedUrl = DB_URL;

// Verifica se já possui parâmetros de query e adiciona sslmode=no-verify se necessário
const hasQueryParams = DB_URL.includes('?');
const sslParam = 'sslmode=no-verify';

// Simple check to avoid double injection if headers already exist
if (!DB_URL.includes('sslmode=')) {
    console.log("⚠️ Detectado ambiente de produção. Injetando 'sslmode=no-verify'...");
    modifiedUrl = hasQueryParams ? `${DB_URL}&${sslParam}` : `${DB_URL}?${sslParam}`;
} else {
    console.log("ℹ️ DATABASE_URL já possui configuração de SSL.");
}

console.log(`🔍 Connection String sendo usada: ${maskUrl(modifiedUrl)}`);

// Atualiza o ambiente
process.env.DATABASE_URL = modifiedUrl;

console.log("🚀 Iniciando Script de Deploy com Retries...");

// Função para tentar executar comando com retries
function runWithRetry(command, retries = 3, delayMs = 2000) {
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
                while (Date.now() - start < delayMs) { } // Busy wait simples
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
