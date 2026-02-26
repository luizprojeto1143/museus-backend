import axios from 'axios';

const ASAAS_API_URL = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3';
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

if (!ASAAS_API_KEY) {
    console.warn("⚠️ ASAAS_API_KEY not configured. Shop payments will fail.");
}

const asaas = axios.create({
    baseURL: ASAAS_API_URL,
    headers: {
        'access_token': ASAAS_API_KEY
    }
});

interface CustomerData {
    name: string;
    email: string;
    cpfCnpj?: string;
    phone?: string;
    mobilePhone?: string;
}

interface SplitData {
    walletId: string;
    fixedValue?: number;
    percentualValue?: number;
    totalFixedValue?: number;
}

interface PaymentData {
    customer: string; // Asaas Customer ID
    billingType: 'UNDEFINED' | 'BOLETO' | 'CREDIT_CARD' | 'PIX';
    value: number;
    dueDate: string; // YYYY-MM-DD
    description?: string;
    externalReference?: string; // Our Order ID
    split?: SplitData[];
}

export const asaasService = {
    /**
     * Creates or retrieves a customer in Asaas
     */
    async createCustomer(data: CustomerData) {
        try {
            // First try to find existing customer by email
            const search = await asaas.get('/customers', { params: { email: data.email } });
            if (search.data.data && search.data.data.length > 0) {
                return search.data.data[0].id;
            }

            // Create new customer
            const response = await asaas.post('/customers', {
                name: data.name,
                email: data.email,
                cpfCnpj: data.cpfCnpj,
                mobilePhone: data.mobilePhone || data.phone
            });
            return response.data.id;
        } catch (error: any) {
            console.error('Asaas Create Customer Error:', error.response?.data || error.message);
            throw new Error('Falha ao registrar cliente no gateway de pagamento');
        }
    },

    /**
     * Creates a payment (Pix/Boleto/Credit Card)
     */
    async createPayment(data: PaymentData) {
        try {
            const response = await asaas.post('/payments', data);
            return {
                id: response.data.id,
                invoiceUrl: response.data.invoiceUrl,
                bankSlipUrl: response.data.bankSlipUrl,
                pixQrCode: null as string | null, // Fill this later if Pix
                ticketUrl: response.data.ticketUrl, // For Boleto
                status: response.data.status
            };
        } catch (error: any) {
            console.error('Asaas Create Payment Error:', error.response?.data || error.message);
            throw new Error('Falha ao criar pagamento');
        }
    },

    /**
     * Get Pix QR Code for a payment
     */
    async getPixQrCode(paymentId: string) {
        try {
            const response = await asaas.get(`/payments/${paymentId}/pixQrCode`);
            return {
                encodedImage: response.data.encodedImage,
                payload: response.data.payload
            };
        } catch (error: any) {
            console.error('Asaas Get Pix Error:', error.response?.data || error.message);
            return null;
        }
    }
};
