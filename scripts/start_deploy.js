import { execSync, spawn } from 'child_process';

const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
    console.error("❌ Erro: DATABASE_URL não está definida.");
    process.exit(1);
}

let modifiedUrl = DB_URL;

// Verifica se já possui parâmetros de query
const hasQueryParams = DB_URL.includes('?');
const sslParam = 'sslmode=no-verify';

// Adiciona sslmode=no-verify se não estiver presente (simples verificação de string)
if (!DB_URL.includes('sslmode=')) {
    console.log("⚠️ Detectado ambiente de produção (provável). Injetando 'sslmode=no-verify' na DATABASE_URL...");
    modifiedUrl = hasQueryParams ? `${DB_URL}&${sslParam}` : `${DB_URL}?${sslParam}`;
} else {
    console.log("ℹ️ DATABASE_URL já possui configuração de SSL.");
}

// Atualiza o ambiente apenas para este processo e filhos
process.env.DATABASE_URL = modifiedUrl;

console.log("🚀 Iniciando Script de Deploy Personalizado...");
console.log("1️⃣ Executando Migrações do Prisma...");

try {
    // Executa migração de forma síncrona para garantir que o banco esteja pronto antes do app
    execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
    console.log("✅ Migrações concluídas com sucesso.");
} catch (error) {
    console.error("❌ Falha crítica ao executar migrações:", error);
    process.exit(1);
}

console.log("2️⃣ Iniciando Aplicação (node dist/index.js)...");

// Inicia a aplicação
const appProcess = spawn('node', ['dist/index.js'], {
    stdio: 'inherit',
    env: process.env
});

appProcess.on('close', (code) => {
    console.log(`Aplicação encerrada com código ${code}`);
    process.exit(code || 0);
});
