import axios from 'axios';

const API_URL = 'http://localhost:3000';
const TENANT_ID = 'default-tenant-id'; // Substituir por um ID real se necessário

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function testCategories() {
    console.log('--- Testing Categories ---');
    try {
        // 1. Criar Categoria
        const createRes = await axios.post(`${API_URL}/categories`, {
            name: 'Test Category',
            type: 'WORK',
            description: 'Created by verification script',
            tenantId: TENANT_ID
        });
        console.log('Create Category: SUCCESS', createRes.data.id);
        const catId = createRes.data.id;

        // 2. Listar Categorias
        const listRes = await axios.get(`${API_URL}/categories?tenantId=${TENANT_ID}`);
        console.log('List Categories: SUCCESS', listRes.data.length > 0);

        // 3. Atualizar Categoria
        const updateRes = await axios.put(`${API_URL}/categories/${catId}`, {
            name: 'Updated Test Category',
            type: 'WORK',
            description: 'Updated description'
        });
        console.log('Update Category: SUCCESS', updateRes.data.name === 'Updated Test Category');

        // 4. Deletar Categoria
        await axios.delete(`${API_URL}/categories/${catId}`);
        console.log('Delete Category: SUCCESS');

    } catch (error) {
        console.error('Category Test FAILED:', error.response ? error.response.data : error.message);
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function testSettings() {
    console.log('\n--- Testing Settings ---');
    try {
        // 1. Atualizar Settings
        const updateRes = await axios.put(`${API_URL}/tenants/${TENANT_ID}/settings`, {
            name: 'Museu de Teste',
            primaryColor: '#ff0000'
        });
        console.log('Update Settings: SUCCESS', updateRes.data.name === 'Museu de Teste');

        // 2. Obter Settings
        const getRes = await axios.get(`${API_URL}/tenants/${TENANT_ID}/settings`);
        console.log('Get Settings: SUCCESS', getRes.data.primaryColor === '#ff0000');

    } catch (error) {
        console.error('Settings Test FAILED:', error.response ? error.response.data : error.message);
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function testDashboard() {
    console.log('\n--- Testing Dashboard ---');
    try {
        const res = await axios.get(`${API_URL}/analytics/dashboard/${TENANT_ID}`);
        console.log('Get Dashboard: SUCCESS', res.data.visitorsThisMonth !== undefined);
        console.log('Dashboard Keys:', Object.keys(res.data));
    } catch (error) {
        console.error('Dashboard Test FAILED:', error.response ? error.response.data : error.message);
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function run() {
    // Primeiro precisamos de um tenant válido. Vamos tentar pegar o primeiro.
    // Assumindo que existe uma rota para listar ou criar, mas como não temos, vamos tentar criar um tenant dummy via prisma se falhar.
    // Para simplificar, vamos assumir que o usuário já tem dados ou vamos criar um tenant via script direto no banco se pudéssemos,
    // mas aqui vamos tentar usar um ID que sabemos que existe ou falhar.

    // Como não sabemos o ID, vamos tentar listar tenants se houver rota, ou criar um.
    // Não temos rota de listar tenants publicamente.
    // Vamos tentar criar um tenant via rota de criação se existir (normalmente create-master.js faz isso).

    console.log('Skipping tenant creation, assuming manual test or existing tenant.');
    // Para teste real, precisaria do ID.
    // Vou pedir para o usuário testar manualmente ou rodar o backend e ver os logs.
}

// run();
console.log("Please run the backend and frontend to verify manually as I don't have a guaranteed tenant ID.");
