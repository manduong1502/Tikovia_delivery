import { Order, OrderStatus, Customer } from '../types';
import { getAllDrivers } from './authService';
import { APP_CONFIG, isServerMode, isGoogleMode } from '../../config';
import { geocodeAddress } from '../services/geoService';

// --- DATA SERVICE ---
const ORDERS_STORAGE_KEY = 'smartlogistics_orders_db';
const CUSTOMERS_STORAGE_KEY = 'smartlogistics_customers_db';

let localOrders: Order[] = [];
let localCustomers: Customer[] = [];

// --- INITIALIZE DATA ---
try {
    const o = localStorage.getItem(ORDERS_STORAGE_KEY);
    if (o) localOrders = JSON.parse(o);

    const c = localStorage.getItem(CUSTOMERS_STORAGE_KEY);
    if (c) localCustomers = JSON.parse(c);
    else {
        localStorage.setItem(CUSTOMERS_STORAGE_KEY, JSON.stringify(localCustomers));
    }
} catch (e) { console.error("Init DB Error:", e); }

const saveLocalOrders = () => localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(localOrders));
const saveLocalCustomers = () => localStorage.setItem(CUSTOMERS_STORAGE_KEY, JSON.stringify(localCustomers));

// --- HELPER: CALL GOOGLE SCRIPT ---
const callGoogleScript = async (action: string, data?: any) => {
    if (data && typeof data === 'object') {
        const payload = { action, ...data };
        try {
            const res = await fetch(APP_CONFIG.GOOGLE_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error(`Google API returned ${res.status}`);
            return await res.json();
        } catch (e) {
            console.error('Failed to fetch POST from Google Script:', e);
            throw e;
        }
    } else {
        let url = `${APP_CONFIG.GOOGLE_SCRIPT_URL}?action=${action}`;
        if (data && typeof data === 'string') {
            url += `&id=${encodeURIComponent(data)}`;
        }
        try {
            const res = await fetch(url, { method: 'GET', mode: 'cors' });
            if (!res.ok) throw new Error(`Google API returned ${res.status}`);
            return await res.json();
        } catch (e) {
            console.error('Failed to fetch GET from Google Script:', e);
            throw e;
        }
    }
};

const syncingOrders = new Set<string>();

export const getOrders = async (): Promise<Order[]> => {
    const cached = localStorage.getItem(ORDERS_STORAGE_KEY);
    let localData = cached ? JSON.parse(cached) : localOrders;

    if (isServerMode()) {
        try {
            const res = await fetch(`${APP_CONFIG.API_BASE_URL}/api/orders`, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${APP_CONFIG.DRIVER_SHARED_SECRET || 'tikovia-driver-secure-key-2026-change-me'}`
                }
            });
            if (res.ok) {
                const serverOrders = await res.json();
                if (Array.isArray(serverOrders) && serverOrders.length > 0) {
                    const merged = serverOrders.map((so: Order) => {
                        if (syncingOrders.has(so.id)) {
                            return localOrders.find(o => o.id === so.id) || so;
                        }
                        return so;
                    });
                    localOrders = merged;
                    saveLocalOrders();
                    return merged;
                }
            }
        } catch (err) {
            console.warn("Backend PostgreSQL API fetch error, falling back to Google Sheets:", err);
        }
    }

    if (isGoogleMode()) {
        try {
            const remote = await callGoogleScript('getOrders');
            if (Array.isArray(remote)) {
                remote.forEach(order => {
                    if (order.itemsString !== undefined && order.itemsString !== null) {
                        order.items = String(order.itemsString).split('|');
                    } else if (!order.items) {
                        order.items = [];
                    }
                    delete order.itemsString;
                    if (!order.note) order.note = "";
                });
                
                const mergedOrders = remote.map((remoteOrder: Order) => {
                    if (syncingOrders.has(remoteOrder.id)) {
                        const existingLocal = localOrders.find(o => o.id === remoteOrder.id);
                        return existingLocal || remoteOrder;
                    }
                    return remoteOrder;
                });
                
                localOrders.forEach(local => {
                    if (syncingOrders.has(local.id) && !mergedOrders.find((o: Order) => o.id === local.id)) {
                        mergedOrders.push(local);
                    }
                });

                localOrders = mergedOrders;
                saveLocalOrders();
                return mergedOrders;
            }
        } catch (e) { 
            console.warn("Google Sync Error - Using Local Data:", e); 
        }
    }
    return localData;
};

export const updateOrder = async (updatedOrder: Order): Promise<Order> => {
    // 1. Update Local Optimistically and mark as syncing
    syncingOrders.add(updatedOrder.id);
    localOrders = localOrders.map((o) => (o.id === updatedOrder.id ? updatedOrder : o));
    saveLocalOrders();

    // 2. Sync to Backend API Server (PostgreSQL)
    if (isServerMode()) {
        try {
            await fetch(`${APP_CONFIG.API_BASE_URL}/api/orders/${updatedOrder.id}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${APP_CONFIG.DRIVER_SHARED_SECRET || 'tikovia-driver-secure-key-2026-change-me'}`
                },
                body: JSON.stringify({
                    status: updatedOrder.status,
                    podImageUrl: updatedOrder.proofOfDelivery?.imageUrl,
                    podSignature: (updatedOrder.proofOfDelivery as any)?.signature,
                    note: updatedOrder.note,
                    codAmount: updatedOrder.codTransaction?.amount,
                    completedAtFormatted: updatedOrder.completedAtFormatted,
                    overtimeString: updatedOrder.overtimeString
                })
            });
        } catch (err) {
            console.warn("Backend API status sync error:", err);
        }
    }

    // 3. Sync to Google Sheets
    if (isGoogleMode()) {
        try {
            const res = await callGoogleScript('saveOrder', updatedOrder);
            if (res && res.imageUrl && updatedOrder.proofOfDelivery) {
                updatedOrder.proofOfDelivery.imageUrl = res.imageUrl;
            }
            if (res && res.orderImageUrl) {
                updatedOrder.orderImage = res.orderImageUrl;
            }
            localOrders = localOrders.map((o) => (o.id === updatedOrder.id ? updatedOrder : o));
            saveLocalOrders();
        } catch (err) {
            console.error("Lỗi đồng bộ Google Sheets:", err);
        } finally {
            syncingOrders.delete(updatedOrder.id);
        }
    } else {
        syncingOrders.delete(updatedOrder.id);
    }
    return updatedOrder;
};

export const deleteOrder = async (orderId: string): Promise<void> => {
    localOrders = localOrders.filter(o => o.id !== orderId);
    saveLocalOrders();

    if (isServerMode()) {
        try {
            await fetch(`${APP_CONFIG.API_BASE_URL}/api/orders/${orderId}`, { 
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${APP_CONFIG.DRIVER_SHARED_SECRET || 'tikovia-driver-secure-key-2026-change-me'}`
                }
            });
        } catch (e) {
            console.error("Server delete failed:", e);
        }
    }

    if (isGoogleMode()) {
        try {
            await callGoogleScript('deleteOrder', orderId);
        } catch (e) {
            console.error("Remote delete failed", e);
        }
    }
};

export const createOrder = async (
    data: Pick<Order, 'customerName' | 'customerPhone' | 'address' | 'orderValue'> & { 
        itemsString: string; 
        location?: { lat: number; lng: number };
        orderImage?: string;
        note?: string;
        routeId?: string;
    },
    userLocation?: { lat: number, lng: number },
    assignedDriver?: { id: string; fullName: string }
): Promise<Order> => {

    let targetLocation = { lat: 0, lng: 0 };
    if (data.location && data.location.lat !== 0) {
        targetLocation = data.location;
    } else {
        const baseLat = userLocation?.lat || 10.762622;
        const baseLng = userLocation?.lng || 106.660172;
        targetLocation = {
            lat: baseLat + ((Math.random() - 0.5) * 0.02),
            lng: baseLng + ((Math.random() - 0.5) * 0.02)
        };
    }

    let finalDriverId = assignedDriver?.id;
    let finalDriverName = assignedDriver?.fullName;
    if (!finalDriverId) {
        const drivers = await getAllDrivers();
        const randomDriver = drivers.length > 0 ? drivers[Math.floor(Math.random() * drivers.length)] : { id: 'unknown', fullName: 'Chưa gán' };
        finalDriverId = randomDriver.id;
        finalDriverName = randomDriver.fullName;
    }

    const newOrder: Order = {
        id: `DH-${Math.floor(Math.random() * 90000) + 10000}`,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        address: data.address,
        location: targetLocation,
        orderValue: data.orderValue,
        status: OrderStatus.ASSIGNED,
        items: (data.itemsString || "").toString().split(',').map(s => s.trim()).filter(Boolean),
        driverId: finalDriverId,
        driverName: finalDriverName,
        orderImage: data.orderImage,
        note: data.note || "",
        routeId: data.routeId || "",
        createdAt: new Date().toISOString()
    };

    if (isServerMode()) {
        try {
            await fetch(`${APP_CONFIG.API_BASE_URL}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...newOrder,
                    itemsString: data.itemsString
                })
            });
        } catch (e) { console.error("PostgreSQL create order error:", e); }
    } else if (isGoogleMode()) {
        try {
            await callGoogleScript('saveOrder', newOrder);
        } catch (e) { console.error(e); }
    }

    localOrders.push(newOrder);
    saveLocalOrders();
    return newOrder;
};

export const hydrateOrdersWithLocation = async (baseLat: number, baseLng: number): Promise<Order[]> => {
    const orders = await getOrders();
    let hasChanges = false;
    const drivers = await getAllDrivers();

    const updatedOrders = await Promise.all(orders.map(async (order, index) => {
        let updated = { ...order };
        
        if (!order.location || (order.location.lat === 0 && order.location.lng === 0)) {
            hasChanges = true;
            if (order.address && order.address.length > 5) {
                try {
                    const geo = await geocodeAddress(order.address);
                    updated.location = { lat: geo.lat, lng: geo.lng };
                } catch (e) {
                    updated.location = {
                        lat: baseLat + ((Math.random() - 0.5) * 0.03),
                        lng: baseLng + ((Math.random() - 0.5) * 0.03),
                    };
                }
            } else {
                updated.location = {
                    lat: baseLat + ((Math.random() - 0.5) * 0.03),
                    lng: baseLng + ((Math.random() - 0.5) * 0.03),
                };
            }
        }

        if (!order.driverId && drivers.length > 0) {
            hasChanges = true;
            const assignedDriver = drivers[index % drivers.length];
            updated.driverId = assignedDriver.id;
            updated.driverName = assignedDriver.fullName;
        }

        if (!order.items) {
            updated.items = [];
        }
        
        return updated;
    }));

    if (hasChanges) {
        for (const o of updatedOrders) {
            await updateOrder(o);
        }
    }
    return updatedOrders;
};

// ==========================================================
// CUSTOMER SERVICES
// ==========================================================

export const getCustomers = async (): Promise<Customer[]> => {
    if (isServerMode()) {
        try {
            const res = await fetch(`${APP_CONFIG.API_BASE_URL}/api/customers`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    localCustomers = data;
                    saveLocalCustomers();
                    return data;
                }
            }
        } catch (err) {
            console.warn("Backend getCustomers error, falling back:", err);
        }
    }

    if (isGoogleMode()) {
        try {
            const data = await callGoogleScript('getCustomers');
            if (Array.isArray(data)) {
                const uniqueCustomers = Array.from(new Map(data.map(item => [item.id, {
                    ...item,
                    phone: String(item.phone || "")
                }])).values());

                localCustomers = uniqueCustomers;
                saveLocalCustomers();
                return uniqueCustomers;
            }
        } catch (e) { console.error("Lỗi tải khách hàng từ Google Sheets:", e); }
    }
    return [...localCustomers];
};

export const addCustomer = async (customerData: Customer): Promise<Customer> => {
    if (isServerMode()) {
        try {
            const res = await fetch(`${APP_CONFIG.API_BASE_URL}/api/customers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(customerData)
            });
            if (res.ok) {
                const created = await res.json();
                localCustomers.unshift(created);
                saveLocalCustomers();
                return created;
            }
        } catch (err) {
            console.warn("Backend addCustomer error, falling back:", err);
        }
    }

    if (isGoogleMode()) {
        try {
            await callGoogleScript('saveCustomer', { 
                action: 'saveCustomer',
                id: customerData.id,
                name: customerData.name,
                phone: String(customerData.phone),
                address: customerData.address,
                location: customerData.location
            });
        } catch (e) { 
            console.error("Lỗi gọi Google Script:", e);
            throw e; 
        }
    }

    localCustomers.unshift(customerData);
    saveLocalCustomers();
    return customerData;
};

export const searchCustomers = async (query: string): Promise<Customer[]> => {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return [];

    if (isServerMode()) {
        try {
            const res = await fetch(`${APP_CONFIG.API_BASE_URL}/api/customers/search?q=${encodeURIComponent(lowerQuery)}`);
            if (res.ok) {
                const results = await res.json();
                if (Array.isArray(results)) return results;
            }
        } catch (err) {
            console.warn("Backend searchCustomers error, falling back to local:", err);
        }
    }

    return localCustomers.filter(c => {
        const name = (c.name || "").toLowerCase();
        const phone = String(c.phone || ""); 
        return name.includes(lowerQuery) || phone.includes(lowerQuery);
    });
};