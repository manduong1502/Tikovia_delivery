import { Order, OrderStatus, Customer } from '../types';
import { getAllDrivers } from './authService';
import { KVCustomer, KVInvoice } from './kiotVietService';
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
                    } else {
                        order.items = [];
                    }
                    delete order.itemsString;
                    if (!order.note) order.note = "";
                });
                
                // Trộn data: Giữ lại những đơn hàng đang trong quá trình đồng bộ ngầm (isSyncing)
                // để không bị dữ liệu cũ (chưa kịp lưu) từ Google Sheet đè lên gây lỗi hiển thị màu.
                const mergedOrders = remote.map((remoteOrder: Order) => {
                    if (syncingOrders.has(remoteOrder.id)) {
                        const existingLocal = localOrders.find(o => o.id === remoteOrder.id);
                        return existingLocal || remoteOrder;
                    }
                    return remoteOrder;
                });
                
                // Giữ lại các đơn local mới tạo đang sync mà chưa kịp lên remote
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

    // 2. Sync to Backend API Server if configured
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
                    podSignature: updatedOrder.proofOfDelivery?.signature,
                    note: updatedOrder.note,
                    codAmount: updatedOrder.codTransaction?.amount
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
            console.log("Sync thành công:", res);
        
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
            // Remove from syncing state so future polls can safely get real data
            syncingOrders.delete(updatedOrder.id);
        }
    } else {
        syncingOrders.delete(updatedOrder.id);
    }
    return updatedOrder;
};

export const deleteOrder = async (orderId: string): Promise<void> => {
    console.debug(`Attempting to delete order: ${orderId}`);

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
            const result = await callGoogleScript('deleteOrder', orderId);
            console.debug(`Remote delete success:`, result);
            return;
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
        createdAt: new Date().toISOString() // Lưu timestamp tạo đơn
    };

    if (isGoogleMode()) {
        try {
            await callGoogleScript('saveOrder', newOrder);
        } catch (e) { console.error(e); }
    } else if (isServerMode()) {
        try {
            await fetch(`${APP_CONFIG.API_BASE_URL}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newOrder)
            });
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

// --- CUSTOMER SERVICES ---

export const getCustomers = async (): Promise<Customer[]> => {
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
        } catch (e) { console.error("Lỗi tải khách hàng từ Server:", e); }
    }
    return [...localCustomers];
};

export const addCustomer = async (customerData: Customer): Promise<Customer> => {
    if (isGoogleMode()) {
        try {
            await callGoogleScript('saveCustomer', { 
                action: 'saveCustomer',
                id: customerData.id,
                name: customerData.name,
                phone: String(customerData.phone),
                address: customerData.address,
                location: customerData.location // <--- BẠN CHỈ CẦN THÊM ĐÚNG DÒNG NÀY
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

export const searchCustomers = (query: string): Promise<Customer[]> => {
    return new Promise(resolve => {
        const lowerQuery = query.toLowerCase();
        const results = localCustomers.filter(c => {
            const name = (c.name || "").toLowerCase();
            const phone = String(c.phone || ""); 
            
            return name.includes(lowerQuery) || phone.includes(query);
        });
        resolve(results);
    });
};

// --- IMPORT HELPERS ---

export const importKiotVietCustomers = async (kvCustomers: KVCustomer[]): Promise<number> => {
    let count = 0;
    const existingIds = new Set(localCustomers.map(c => c.name + c.phone));

    for (const kv of kvCustomers) {
        if (!existingIds.has(kv.name + kv.contactNumber)) {
            const addr = kv.address || kv.locationName || 'Chưa cập nhật địa chỉ';
            const newCust: Customer = {
                id: `KV-${kv.code}`,
                name: kv.name,
                phone: kv.contactNumber || '',
                address: addr
            };
            localCustomers.unshift(newCust);
            existingIds.add(kv.name + kv.contactNumber);
            count++;
            
            if (isGoogleMode()) callGoogleScript('saveCustomer', { ...newCust, action: 'saveCustomer' }).catch(console.error);
        }
    }
    if (count > 0) saveLocalCustomers();
    return count;
};

export const importKiotVietOrders = async (kvInvoices: KVInvoice[]): Promise<number> => {
    let count = 0;
    const drivers = await getAllDrivers();
    const currentOrders = await getOrders();
    const existingOrderIds = new Set(currentOrders.map(o => o.id));

    for (const inv of kvInvoices) {
        const orderId = `DH-${inv.code}`;
        if (!existingOrderIds.has(orderId)) {
            let address = inv.deliveryDetail?.address || 'Tại cửa hàng';
            const location = {
                lat: 10.762622 + (Math.random() - 0.5) * 0.04,
                lng: 106.660172 + (Math.random() - 0.5) * 0.04
            };
            const driver = drivers.length > 0 ? drivers[Math.floor(Math.random() * drivers.length)] : undefined;
            const items = inv.invoiceDetails.map(d => `${d.productName} (x${d.quantity})`);

            const newOrder: Order = {
                id: orderId,
                customerName: inv.customerName || 'Khách lẻ',
                address: address,
                location: location,
                orderValue: inv.total,
                status: OrderStatus.ASSIGNED,
                items: items,
                driverId: driver?.id,
                driverName: driver?.fullName,
                createdAt: inv.createdDate || new Date().toISOString()
            };

            if (isGoogleMode()) {
                await callGoogleScript('saveOrder', newOrder);
            } else if (isServerMode()) {
                await fetch(`${APP_CONFIG.API_BASE_URL}/api/orders`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newOrder)
                });
            } else {
                localOrders.push(newOrder);
            }
            count++;
        }
    }

    if (!isServerMode() && !isGoogleMode() && count > 0) saveLocalOrders();
    return count;
};