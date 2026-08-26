import { APP_CONFIG, isServerMode } from '../../config';

// Interfaces matching KiotViet API Structure
export interface KVConfig {
    clientId: string;
    clientSecret: string;
    retailer: string;
}

export interface KVCustomer {
    id: number;
    code: string;
    name: string;
    contactNumber: string;
    address: string;
    locationName: string; 
}

export interface KVInvoiceDetail {
    productName: string;
    quantity: number;
    price: number;
}

export interface KVInvoice {
    id: number;
    code: string;
    purchaseDate: string;
    customerName: string;
    customerCode: string;
    deliveryDetail?: {
        address?: string;
        contactNumber?: string;
        receiver?: string;
        status?: number; 
    };
    total: number;
    status: number; 
    invoiceDetails: KVInvoiceDetail[];
    createdDate?: string;
}

const AUTH_URL = 'https://id.kiotviet.vn/connect/token';
const API_URL = 'https://public.kiotapi.com';

// Fallback Proxy nếu không có Server riêng
const PUBLIC_PROXY = 'https://thingproxy.freeboard.io/fetch/'; 

export const kiotVietService = {
    getAccessToken: async (config: KVConfig): Promise<string> => {
        const params = new URLSearchParams();
        params.append('scopes', 'PublicApi.Access');
        params.append('grant_type', 'client_credentials');
        params.append('client_id', config.clientId);
        params.append('client_secret', config.clientSecret);

        try {
            let response;
            
            if (isServerMode()) {
                // CÁCH 1: Gọi qua Server Riêng (An toàn & Ổn định)
                // POST /api/kiotviet/token
                response = await fetch(`${APP_CONFIG.API_BASE_URL}/api/kiotviet/token`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }, // Server riêng thường nhận JSON
                    body: JSON.stringify({
                        scopes: 'PublicApi.Access',
                        grant_type: 'client_credentials',
                        client_id: config.clientId,
                        client_secret: config.clientSecret
                    })
                });
            } else {
                // CÁCH 2: Dùng Public Proxy (Demo Only)
                const proxyUrl = `${PUBLIC_PROXY}${AUTH_URL}`;
                response = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params
                });
            }

            if (!response.ok) throw new Error('Lỗi xác thực KiotViet');
            const data = await response.json();
            return data.access_token;
        } catch (error: any) {
            console.error("KiotViet Auth Error:", error);
            throw new Error(error.message || 'Lỗi kết nối.');
        }
    },

    getCustomers: async (accessToken: string, retailer: string, limit = 50): Promise<KVCustomer[]> => {
        const targetUrl = `${API_URL}/customers?pageSize=${limit}`;
        try {
            let response;

            if (isServerMode()) {
                 // Gọi qua Server Riêng
                 // GET /api/kiotviet/proxy?url=...
                 const svUrl = `${APP_CONFIG.API_BASE_URL}/api/kiotviet/proxy?url=${encodeURIComponent(targetUrl)}&token=${accessToken}&retailer=${retailer}`;
                 response = await fetch(svUrl);
            } else {
                // Gọi qua Public Proxy
                response = await fetch(`${PUBLIC_PROXY}${targetUrl}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Retailer': retailer
                    }
                });
            }
            
            if (!response.ok) throw new Error('Failed to fetch customers');
            const data = await response.json();
            return data.data || [];
        } catch (error) {
            console.error(error);
            return [];
        }
    },

    getRecentInvoices: async (accessToken: string, retailer: string, limit = 20): Promise<KVInvoice[]> => {
        const targetUrl = `${API_URL}/invoices?pageSize=${limit}&includes=InvoiceDetails,DeliveryDetail`;
        try {
            let response;

            if (isServerMode()) {
                 const svUrl = `${APP_CONFIG.API_BASE_URL}/api/kiotviet/proxy?url=${encodeURIComponent(targetUrl)}&token=${accessToken}&retailer=${retailer}`;
                 response = await fetch(svUrl);
            } else {
                response = await fetch(`${PUBLIC_PROXY}${targetUrl}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Retailer': retailer
                    }
                });
            }

            if (!response.ok) throw new Error('Failed to fetch invoices');
            const data = await response.json();
            return data.data || [];
        } catch (error) {
            console.error(error);
            return [];
        }
    }
};