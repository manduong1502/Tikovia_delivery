import React, { useState, useEffect, useRef } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Order, OrderStatus, User, Customer } from '../types';
import { createDriver, getAllDrivers } from '../services/authService';
import { getOrders, getCustomers, addCustomer, deleteOrder } from '../services/mockDb';
import { subscribeToDrivers } from '../services/trackingService';
import MapPicker from './MapPicker';

interface ManagerDashboardProps {
    orders: Order[];
    onBack: () => void; // This will now act as Logout
}

interface SearchResult {
    place_id: number;
    lat: string;
    lon: string;
    display_name: string;
    address?: {
        road?: string;
        suburb?: string;
        city?: string;
        state?: string;
        house_number?: string;
    };
}

const statusLabels: Record<OrderStatus, string> = {
    [OrderStatus.ASSIGNED]: 'Đã gán',
    [OrderStatus.DELIVERING]: 'Đang giao',
    [OrderStatus.ARRIVED]: 'Đã đến',
    [OrderStatus.DELIVERED]: 'Hoàn tất',
    [OrderStatus.CANCELED]: 'Đã hủy'
};

// --- HÀM HỖ TRỢ HIỂN THỊ ẢNH (FIX LỖI LINK DRIVE) ---
const getDirectDriveUrl = (url: string | undefined | null) => {
    if (!url) return '';
    if (url.includes('drive.google.com')) {
        try {
            let id = '';
            if (url.includes('/file/d/')) {
                id = url.split('/file/d/')[1].split('/')[0];
            } else if (url.includes('id=')) {
                id = url.split('id=')[1].split('&')[0];
            }
            if (id) {
                // Link thumbnail size lớn (w1000) để load nhanh và không bị lỗi view
                return `https://drive.google.com/thumbnail?id=${id}&sz=w1000`;
            }
        } catch (e) {
            return url;
        }
    }
    return url;
};

// --- HÀM KIỂM TRA CÙNG NGÀY ---
const isToday = (order: Order) => {
    let dateObj: Date | null = null;

    if (order.createdAt) {
        const dateString = String(order.createdAt).trim();
        
        if (dateString.includes('/')) {
            const parts = dateString.split(/[ /:]+/);
            
            if (parts.length >= 6) {
                let day: number, month: number, year: number;
                const p5 = parseInt(parts[5], 10);
                const p2 = parseInt(parts[2], 10);
                
                if (p5 > 2000) {
                    // Format: HH:mm:ss DD/MM/YYYY
                    year = p5;
                    day = parseInt(parts[3], 10);
                    month = parseInt(parts[4], 10) - 1;
                } else if (p2 > 2000) {
                    // Format: DD/MM/YYYY HH:mm:ss
                    day = parseInt(parts[0], 10);
                    month = parseInt(parts[1], 10) - 1;
                    year = p2;
                } else {
                    dateObj = new Date(dateString);
                    day = dateObj.getDate();
                    month = dateObj.getMonth();
                    year = dateObj.getFullYear();
                }
                if (!dateObj || isNaN(dateObj.getTime())) {
                    dateObj = new Date(year, month, day);
                }
            } else if (parts.length >= 3) {
                const p0 = parseInt(parts[0], 10);
                const p1 = parseInt(parts[1], 10);
                const p2 = parseInt(parts[2], 10);
                let day: number, month: number, year: number;
                if (p2 > 2000) {
                    year = p2; day = p0; month = p1 - 1;
                } else {
                    dateObj = new Date(dateString);
                    day = dateObj.getDate(); month = dateObj.getMonth(); year = dateObj.getFullYear();
                }
                if (!dateObj || isNaN(dateObj.getTime())) {
                    dateObj = new Date(year, month, day);
                }
            } else {
                dateObj = new Date(dateString);
            }
        } else {
            dateObj = new Date(order.createdAt);
        }
    }

    // Fallback: parse từ order ID
    if ((!dateObj || isNaN(dateObj.getTime())) && order.id && order.id.startsWith('DH-')) {
        const idPart = order.id.split('-')[1];
        if (idPart && idPart.length >= 12) {
            const timestamp = parseInt(idPart, 10);
            if (!isNaN(timestamp)) {
                dateObj = new Date(timestamp);
            }
        }
    }

    // Nếu không parse được → mặc định hiện đơn
    if (!dateObj || isNaN(dateObj.getTime())) {
        return true;
    }

    const today = new Date();
    return dateObj.getDate() === today.getDate() &&
        dateObj.getMonth() === today.getMonth() &&
        dateObj.getFullYear() === today.getFullYear();
};

const ManagerDashboard: React.FC<ManagerDashboardProps> = ({ orders: initialOrders, onBack }) => {
    const [orders, setOrders] = useState<Order[]>(initialOrders);
    const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'MAP' | 'DRIVERS' | 'CUSTOMERS'>('OVERVIEW');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // --- STATE MỚI: DANH SÁCH TÀI XẾ ONLINE (FIREBASE) ---
    const [liveDrivers, setLiveDrivers] = useState<any[]>([]);

    // Driver Management State
    const [drivers, setDrivers] = useState<User[]>([]);
    const [newDriverName, setNewDriverName] = useState('');
    const [newDriverUsername, setNewDriverUsername] = useState('');
    const [newDriverPassword, setNewDriverPassword] = useState('');
    const [createDriverError, setCreateDriverError] = useState('');
    const [createDriverSuccess, setCreateDriverSuccess] = useState('');

    // Customer Management State
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [newCustName, setNewCustName] = useState('');
    const [newCustPhone, setNewCustPhone] = useState('');
    const [newCustAddress, setNewCustAddress] = useState('');
    const [addCustSuccess, setAddCustSuccess] = useState('');
    const [newCustLocation, setNewCustLocation] = useState<{lat: number, lng: number} | undefined>(undefined);

    // Address Suggestions State
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Thêm state cho MapPicker trong phần khách hàng
    const [showMapPicker, setShowMapPicker] = useState(false);

    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);

    // --- EFFECT MỚI: KẾT NỐI FIREBASE KHI MỞ TAB MAP ---
    useEffect(() => {
        if (activeTab === 'MAP') {
            const unsubscribe = subscribeToDrivers((data) => {
                setLiveDrivers(data);
            });
            return () => unsubscribe();
        }
    }, [activeTab]);

    // --- Data Fetching ---
    const fetchLatestData = async () => {
        setIsRefreshing(true);
        const latestOrders = await getOrders();
        setOrders(latestOrders);
        
        // Gọi API lấy dữ liệu tài xế từ Google Sheet (đã thêm await)
        const latestDrivers = await getAllDrivers();
        setDrivers(latestDrivers);
        
        const latestCustomers = await getCustomers();
        setCustomers(latestCustomers);
        setIsRefreshing(false);
    };

    useEffect(() => {
        const interval = setInterval(fetchLatestData, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        setOrders(initialOrders);
    }, [initialOrders]);

    // Gọi API lần đầu tiên khi component render
    useEffect(() => {
        getAllDrivers().then(setDrivers).catch(console.error);
        getCustomers().then(setCustomers).catch(console.error);
    }, []);

    // Chỉ lấy đơn hàng của ngày hôm nay
    const todayOrders = orders.filter(o => isToday(o));

    const totalRevenue = todayOrders.reduce((sum, o) => sum + (o.codTransaction?.amount || 0), 0);
    const pendingRevenue = todayOrders
        .filter(o => o.status !== OrderStatus.DELIVERING && o.status !== OrderStatus.CANCELED)
        .reduce((sum, o) => sum + (o.orderValue || 0), 0);

    const statusCounts = todayOrders.reduce((acc, o) => {
        acc[o.status] = (acc[o.status] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    const activeDriversCount = new Set(
        todayOrders.filter(o => o.status === OrderStatus.DELIVERING || o.status === OrderStatus.ASSIGNED)
            .map(o => o.driverName)
    ).size;

    const handleCreateDriver = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreateDriverError('');
        setCreateDriverSuccess('');

        try {
            const newDriver = await createDriver({
                fullName: newDriverName,
                username: newDriverUsername,
                password: newDriverPassword
            });
            setDrivers([...drivers, newDriver]);
            setCreateDriverSuccess('Tạo tài khoản thành công!');
            setNewDriverName('');
            setNewDriverUsername('');
            setNewDriverPassword('');
        } catch (err: any) {
            setCreateDriverError(err.message || 'Lỗi khi tạo tài khoản');
        }
    };

    // --- ADDRESS SEARCH LOGIC ---
    const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setNewCustAddress(value);

        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

        if (value.length > 2) {
            setIsSearching(true);
            setShowSuggestions(true);
            searchTimeoutRef.current = setTimeout(async () => {
                try {
                    const response = await fetch(
                        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(value)}&countrycodes=vn&limit=5&addressdetails=1`
                    );
                    const data = await response.json();
                    setSearchResults(data);
                } catch (err) {
                    console.error("Address search failed", err);
                } finally {
                    setIsSearching(false);
                }
            }, 400);
        } else {
            setSearchResults([]);
            setShowSuggestions(false);
            setIsSearching(false);
        }
    };

    const selectAddress = (result: SearchResult) => {
        const houseNumberRegex = /^(\d+[\w\/]*)\s/;
        const match = newCustAddress.match(houseNumberRegex);
        let finalAddress = result.display_name;

        if (match) {
            const prefix = match[1];
            if (!finalAddress.toLowerCase().startsWith(prefix.toLowerCase())) {
                finalAddress = `${prefix} ${finalAddress}`;
            }
        }

        setNewCustAddress(finalAddress);
        // THÊM ĐOẠN NÀY ĐỂ LƯU TỌA ĐỘ KHI CHỌN GỢI Ý TỪ THANH TÌM KIẾM
        setNewCustLocation({
            lat: parseFloat(result.lat),
            lng: parseFloat(result.lon)
        });
        
        setShowSuggestions(false);
        setSearchResults([]);
    };

    const handleAddCustomer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newCustName || !newCustAddress) return;

        const tempId = `KH${Date.now().toString().slice(-4)}`;
        const newCust: Customer = {
            id: tempId,
            name: newCustName,
            phone: newCustPhone,
            address: newCustAddress,
            location: newCustLocation // BỔ SUNG TRƯỜNG NÀY
        };

        setCustomers(prev => [newCust, ...prev]);
        
        // Reset form
        setNewCustName('');
        setNewCustPhone('');
        setNewCustAddress('');
        setNewCustLocation(undefined); // RESET TỌA ĐỘ
        setSearchResults([]);
        setAddCustSuccess('Đang lưu...');

        try {
            await addCustomer({
                id: tempId,
                name: newCust.name,
                phone: newCust.phone,
                address: newCust.address,
                location: newCust.location // GỬI LÊN API
            });
            
            setAddCustSuccess('Đã lưu thành công!');
            setTimeout(() => { fetchLatestData(); }, 2000);

        } catch (error) {
            console.error("Lỗi lưu:", error);
            setAddCustSuccess('Lỗi kết nối!');
            setCustomers(prev => prev.filter(c => c.id !== tempId));
        }
        
        setTimeout(() => setAddCustSuccess(''), 3000);
    };

    const handleDeleteOrder = async () => {
        if (!selectedOrder) return;
        if (window.confirm(`Bạn có chắc muốn xóa đơn hàng ${selectedOrder.id}?`)) {
            await deleteOrder(selectedOrder.id);
            setOrders(prev => prev.filter(o => o.id !== selectedOrder.id));
            setSelectedOrder(null);
            setTimeout(fetchLatestData, 1000);
        }
    };

    // --- MAP EFFECT ---
    useEffect(() => {
        const todayOrders = orders.filter(o => isToday(o));
        if (activeTab === 'MAP' && mapContainerRef.current && !mapInstanceRef.current) {
            const centerLat = todayOrders.length > 0 ? todayOrders[0].location.lat : 16.0123;
            const centerLng = todayOrders.length > 0 ? todayOrders[0].location.lng : 108.2133;

            const map = L.map(mapContainerRef.current).setView([centerLat, centerLng], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© OpenStreetMap'
            }).addTo(map);

            setTimeout(() => {
                try {
                    map.invalidateSize(true);
                    if (todayOrders.length > 0) {
                        const bounds = L.latLngBounds(todayOrders.map(o => [o.location.lat, o.location.lng]));
                        map.fitBounds(bounds, { padding: [50, 50] });
                    }
                } catch (e) { console.warn('fitBounds failed', e); }
            }, 300);

            mapInstanceRef.current = map;
        }

        if (activeTab === 'MAP' && mapInstanceRef.current) {
            const map = mapInstanceRef.current;

            // Xóa các marker cũ
            map.eachLayer((layer: any) => {
                if (layer instanceof L.Marker) map.removeLayer(layer);
            });

            // 1. VẼ MARKER ĐƠN HÀNG HÔM NAY
            const markers = L.featureGroup();
            todayOrders.forEach((order: Order) => {
                let color = '#3b82f6';
                if (order.status === OrderStatus.DELIVERED) color = '#22c55e';
                if (order.status === OrderStatus.ASSIGNED) color = '#9ca3af';
                if (order.status === OrderStatus.ARRIVED) color = '#a855f7';

                const markerHtml = `<div style="background-color: ${color}; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3); color: white; font-weight: bold; font-size: 10px;">${order.status === OrderStatus.DELIVERED ? '✓' : ''}</div>`;
                const icon = L.divIcon({ className: 'custom-pin', html: markerHtml, iconSize: [24, 24], iconAnchor: [12, 12] });

                const codValue = (order.orderValue || 0).toLocaleString();
                const marker = L.marker([order.location.lat, order.location.lng], { icon }).bindPopup(`<b>${order.id}</b><br/>Tài xế: ${order.driverName}<br/>COD: ${codValue}đ<br/>Trạng thái: ${statusLabels[order.status]}`);
                markers.addLayer(marker);
            });
            if (todayOrders.length > 0) markers.addTo(map);

            // 2. VẼ MARKER TÀI XẾ LIVE
            liveDrivers.forEach(driver => {
                if (driver.lat && driver.lng) {
                    const driverIcon = L.divIcon({
                        className: 'driver-live-icon',
                        html: `<div style="background-color: #ef4444; width: 32px; height: 32px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 15px rgba(239, 68, 68, 0.6); display: flex; align-items: center; justify-content: center; position: relative;">
                                <div style="position: absolute; width: 100%; height: 100%; border-radius: 50%; border: 2px solid #ef4444; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite; opacity: 0.5;"></div>
                                <svg style="width: 18px; height: 18px; color: white;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                               </div>`,
                        iconSize: [32, 32],
                        iconAnchor: [16, 16]
                    });

                    L.marker([driver.lat, driver.lng], { icon: driverIcon, zIndexOffset: 1000 })
                        .bindPopup(`
                            <div style="text-align: center; min-width: 120px;">
                                <b style="color: #dc2626; font-size: 14px;">${driver.name}</b>
                                <div style="font-size: 11px; color: #666; margin-top: 4px;">
                                    Đang giao: <b>${driver.orderId || 'Trống'}</b>
                                </div>
                                <div style="font-size: 10px; color: #999; margin-top: 2px;">
                                    Cập nhật: ${new Date(driver.lastUpdated).toLocaleTimeString()}
                                </div>
                            </div>
                        `)
                        .addTo(map);
                }
            });
        }

        return () => {
            if (activeTab !== 'MAP' && mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
            }
        };
    }, [activeTab, orders, liveDrivers]);

    // Pan to selected order
    useEffect(() => {
        if (activeTab === 'MAP' && selectedOrder && mapInstanceRef.current) {
            try {
                const map = mapInstanceRef.current;
                const latlng = [selectedOrder.location.lat, selectedOrder.location.lng] as [number, number];
                map.setView(latlng, 15, { animate: true });
                const popup = L.popup({ closeButton: true, autoClose: true }).setLatLng(latlng).setContent(`<b>${selectedOrder.id}</b><br/>${selectedOrder.driverName}`).openOn(map);
            } catch (e) { console.warn('Unable to pan to selected order', e); }
        }
    }, [selectedOrder, activeTab]);

    return (
        <div className="flex flex-col h-full bg-gray-50 relative">
            {/* Header */}
            <div className="bg-white pt-9 pr-[75px] p-4 shadow-sm flex items-center justify-between sticky top-0 z-10 border-b border-gray-100">
                <div className="flex items-center gap-2">
                    <h1 className="font-bold text-gray-800 text-lg">Quản trị viên</h1>
                </div>
                <button onClick={onBack} className="text-red-500 font-medium text-sm flex items-center gap-1 bg-red-50 px-4 py-2 rounded-full transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                    Đăng xuất
                </button>
            </div>

            {/* Tabs */}
            <div className="flex bg-white border-b border-gray-200 overflow-x-auto no-scrollbar">
                <button onClick={() => setActiveTab('OVERVIEW')} className={`flex-1 min-w-[100px] py-3 text-sm font-bold border-b-2 whitespace-nowrap ${activeTab === 'OVERVIEW' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Tổng quan</button>
                <button onClick={() => setActiveTab('MAP')} className={`flex-1 min-w-[100px] py-3 text-sm font-bold border-b-2 whitespace-nowrap ${activeTab === 'MAP' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Bản đồ Live</button>
                <button onClick={() => setActiveTab('DRIVERS')} className={`flex-1 min-w-[100px] py-3 text-sm font-bold border-b-2 whitespace-nowrap ${activeTab === 'DRIVERS' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Nhân viên</button>
                <button onClick={() => setActiveTab('CUSTOMERS')} className={`flex-1 min-w-[100px] py-3 text-sm font-bold border-b-2 whitespace-nowrap ${activeTab === 'CUSTOMERS' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Khách hàng</button>
            </div>

            <div className="flex-1 overflow-y-auto bg-gray-50 relative">
                {activeTab === 'OVERVIEW' && (
                    <div className="p-4 space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                                <div className="text-gray-400 text-xs uppercase font-bold mb-1">Doanh thu thực tế</div>
                                <div className="text-xl font-bold text-green-600">{totalRevenue.toLocaleString()} đ</div>
                            </div>
                            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                                <div className="text-gray-400 text-xs uppercase font-bold mb-1">COD Đang giao</div>
                                <div className="text-xl font-bold text-blue-600">{pendingRevenue.toLocaleString()} đ</div>
                            </div>
                            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                                <div className="text-gray-400 text-xs uppercase font-bold mb-1">Tài xế hoạt động</div>
                                <div className="text-xl font-bold text-gray-800">{activeDriversCount}</div>
                            </div>
                            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                                <div className="text-gray-400 text-xs uppercase font-bold mb-1">Đã hoàn tất</div>
                                <div className="text-xl font-bold text-gray-800">{statusCounts[OrderStatus.DELIVERED] || 0} <span className="text-xs font-normal text-gray-400">/ {todayOrders.length} đơn</span></div>
                            </div>
                        </div>
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="px-4 py-3 border-b border-gray-100 font-bold text-gray-800 bg-gray-50 flex justify-between items-center">
                                <span>Danh sách đơn hàng (Hôm nay: {todayOrders.length})</span>
                                <span className="text-xs font-normal text-gray-500 animate-pulse">Cập nhật tự động</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-3">Tuyến</th>
                                            <th className="px-4 py-3">Tài xế</th>
                                            <th className="px-4 py-3">Khách hàng</th>
                                            <th className="px-4 py-3">Tiền hàng</th>
                                            <th className="px-4 py-3">Thực nhận (COD)</th>
                                            <th className="px-4 py-3 text-right">Trạng thái</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {todayOrders.map((order) => {
                                            const actualCOD = order.codTransaction?.amount !== undefined 
                                                ? order.codTransaction.amount 
                                                : ((order as any).codAmount !== undefined && (order as any).codAmount !== "" ? Number((order as any).codAmount) : null);
                                                
                                            return (
                                                <tr key={order.id} onClick={() => setSelectedOrder(order)} className="border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors">
                                                    <td className="px-4 py-3 font-bold text-blue-600 whitespace-nowrap">{order.routeId || '---'}</td>
                                                    <td className="px-4 py-3 text-gray-600"><div className="font-medium whitespace-nowrap">{order.driverName}</div></td>
                                                    <td className="px-4 py-3 font-medium text-gray-800"><div className="line-clamp-1 min-w-[120px]">{order.customerName}</div></td>
                                                    <td className="px-4 py-3 font-mono text-gray-500 whitespace-nowrap">{(order.orderValue || 0).toLocaleString()}</td>
                                                    <td className="px-4 py-3 font-mono font-bold text-green-600 whitespace-nowrap">{actualCOD !== null ? actualCOD.toLocaleString() : '-'}</td>
                                                    <td className="px-4 py-3 text-right whitespace-nowrap">
                                                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold border whitespace-nowrap ${order.status === OrderStatus.DELIVERED ? 'bg-green-100 text-green-700 border-green-200' : order.status === OrderStatus.DELIVERING ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                                                            {statusLabels[order.status]}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'DRIVERS' && (
                    <div className="p-4 space-y-6">
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                                <div className="bg-blue-100 p-1.5 rounded text-blue-600">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
                                </div>
                                Tạo tài khoản nhân viên
                            </h3>
                            <form onSubmit={handleCreateDriver} className="space-y-3">
                                <div>
                                    <label className="text-xs font-bold text-gray-500 uppercase">Họ và tên</label>
                                    <input required type="text" value={newDriverName} onChange={e => setNewDriverName(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg mt-1 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Nguyễn Văn A" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase">Tên đăng nhập</label>
                                        <input required type="text" value={newDriverUsername} onChange={e => setNewDriverUsername(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg mt-1 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="user1" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase">Mật khẩu</label>
                                        <input required type="text" value={newDriverPassword} onChange={e => setNewDriverPassword(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg mt-1 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="123456" />
                                    </div>
                                </div>
                                {createDriverError && <p className="text-red-500 text-xs font-bold">{createDriverError}</p>}
                                {createDriverSuccess && <p className="text-green-500 text-xs font-bold">{createDriverSuccess}</p>}
                                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-lg shadow-md active:scale-95 transition-all mt-2">Tạo tài khoản</button>
                            </form>
                        </div>
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="px-4 py-3 border-b border-gray-100 font-bold text-gray-800 bg-gray-50">Danh sách nhân viên ({drivers.length})</div>
                            <ul className="divide-y divide-gray-100">
                                {drivers.map(driver => (
                                    <li key={driver.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-bold">{driver.fullName.charAt(0)}</div>
                                            <div>
                                                <div className="font-bold text-gray-800">{driver.fullName}</div>
                                                <div className="text-xs text-gray-500">@{driver.username}</div>
                                            </div>
                                        </div>
                                        <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-bold border border-green-200">Active</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}

                {activeTab === 'CUSTOMERS' && (
                    <div className="p-4 space-y-6">
                        {showMapPicker && (
                            <MapPicker
                                onLocationSelected={(location, addr) => {
                                    setNewCustAddress(addr);
                                    setNewCustLocation(location);
                                    setShowMapPicker(false);
                                }}
                                onCancel={() => setShowMapPicker(false)}
                            />
                        )}
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm relative">
                            <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                                <div className="bg-purple-100 p-1.5 rounded text-purple-600">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                </div>
                                Thêm khách hàng mới
                            </h3>

                            <form onSubmit={handleAddCustomer} className="space-y-3">
                                <div>
                                    <label className="text-xs font-bold text-gray-500 uppercase">Tên khách hàng</label>
                                    <input required type="text" value={newCustName} onChange={e => setNewCustName(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg mt-1 focus:ring-2 focus:ring-purple-500 outline-none" placeholder="Công ty ABC..." />
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-gray-500 uppercase">Số điện thoại</label>
                                    <input type="tel" value={newCustPhone} onChange={e => setNewCustPhone(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg mt-1 focus:ring-2 focus:ring-purple-500 outline-none" placeholder="090..." />
                                </div>

                                <div className="relative">
                                    <label className="text-xs font-bold text-gray-500 uppercase">Địa chỉ</label>
                                    <div className="relative mt-1">
                                        <input
                                            required
                                            type="text"
                                            value={newCustAddress}
                                            onChange={handleAddressChange}
                                            onFocus={() => { if (newCustAddress.length > 2) setShowSuggestions(true); }}
                                            className={`w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-purple-500 outline-none transition-all ${showSuggestions && searchResults.length > 0 ? 'border-purple-400 rounded-b-none' : 'border-gray-300'}`}
                                            placeholder="Số nhà, tên đường..."
                                            autoComplete="off"
                                        />
                                        {isSearching && (
                                            <div className="absolute right-3 top-3">
                                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
                                            </div>
                                        )}
                                    </div>

                                    {showSuggestions && searchResults.length > 0 && (
                                        <ul className="absolute z-[60] w-full bg-white border-x border-b border-gray-200 rounded-b-xl shadow-2xl max-h-72 overflow-y-auto overflow-x-hidden">
                                            {searchResults.map((result) => (
                                                <li
                                                    key={result.place_id}
                                                    onClick={() => selectAddress(result)}
                                                    className="p-3.5 hover:bg-purple-50 cursor-pointer border-b border-gray-50 last:border-0 flex items-start gap-3 transition-colors group"
                                                >
                                                    <div className="bg-gray-100 p-2 rounded-full text-gray-400 group-hover:bg-purple-100 group-hover:text-purple-600 transition-colors mt-0.5">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-sm text-gray-900 font-bold line-clamp-1">
                                                            {result.display_name.split(',')[0]}
                                                        </span>
                                                        <span className="text-[11px] text-gray-500 line-clamp-1 mt-0.5">
                                                            {result.display_name.split(',').slice(1).join(',').trim()}
                                                        </span>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setShowMapPicker(true)}
                                        className="mt-2 w-full bg-green-50 hover:bg-green-100 text-green-700 font-bold py-2.5 rounded-xl border border-green-200 flex items-center justify-center gap-2 transition-all"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                        Chọn vị trí trên bản đồ (chính xác hơn)
                                    </button>
                                </div>

                                {addCustSuccess && <p className="text-green-600 text-sm font-bold flex items-center gap-1"><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>{addCustSuccess}</p>}
                                <button type="submit" className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-xl shadow-lg active:scale-95 transition-all mt-4">Lưu khách hàng</button>
                            </form>
                        </div>

                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="px-4 py-3 border-b border-gray-100 font-bold text-gray-800 bg-gray-50">Danh sách khách hàng ({customers.length})</div>
                            <ul className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
                                {customers.map(cust => (
                                    <li key={cust.id} className="p-4 hover:bg-gray-50 transition-colors">
                                        <div className="flex justify-between items-start">
                                            <div className="flex gap-3">
                                                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-400 font-bold shrink-0">{cust.name.charAt(0)}</div>
                                                <div>
                                                    <div className="font-bold text-gray-800 text-base">{cust.name}</div>
                                                    <div className="text-sm text-gray-500 mt-0.5 leading-snug">{cust.address}</div>
                                                    {cust.phone && <div className="text-xs text-blue-600 mt-1.5 flex items-center gap-1 font-medium bg-blue-50 w-fit px-2 py-0.5 rounded-full"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>{cust.phone}</div>}
                                                </div>
                                            </div>
                                            <span className="text-[10px] text-gray-300 font-mono tracking-tighter bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">{cust.id}</span>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}

                {activeTab === 'MAP' && (
                    <div className="p-4" style={{ height: 'calc(100vh - 120px)', paddingBottom: '16px', boxSizing: 'border-box' }}>
                        <div id="manager-map" ref={mapContainerRef} className="w-full h-full rounded-xl overflow-hidden border border-gray-200 shadow-inner" style={{ minHeight: '60vh', padding: 0, marginBottom: '16px' }} />
                    </div>
                )}
            </div>

            {selectedOrder && (
                <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-center pointer-events-none">
                    <div className="fixed inset-0 bg-black/50 pointer-events-auto transition-opacity" onClick={() => setSelectedOrder(null)}></div>
                    <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto pointer-events-auto animate-slide-up sm:animate-none">
                        <div className="sticky top-0 bg-white border-b border-gray-100 p-4 flex items-center justify-between z-10 rounded-t-2xl">
                            <div className="flex flex-col"><h2 className="text-xl font-bold text-gray-800">Chi tiết đơn hàng</h2><span className="text-xs text-gray-400 font-mono">{selectedOrder.id}</span></div>
                            <div className="flex items-center gap-2">
                                <button onClick={handleDeleteOrder} className="p-2 text-red-500 hover:bg-red-50 rounded-full transition-colors" title="Xóa đơn hàng"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                                <button onClick={() => setSelectedOrder(null)} className="bg-gray-100 p-2 rounded-full hover:bg-gray-200"><svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                            </div>
                        </div>
                        <div className="p-5 space-y-6">
                            <div className="flex items-center justify-between bg-blue-50 p-3 rounded-lg border border-blue-100">
                                <div><div className="text-xs text-blue-800 uppercase font-bold mb-1">Trạng thái hiện tại</div><div className="text-blue-900 font-bold text-lg">{statusLabels[selectedOrder.status]}</div></div>
                                <div className="text-right"><div className="text-xs text-blue-800 uppercase font-bold mb-1">Nhân viên phụ trách</div><div className="text-blue-900 font-medium">{selectedOrder.driverName}</div></div>
                            </div>
                            <div className="space-y-4">
                                <div><label className="text-xs font-bold text-gray-400 uppercase">Khách hàng</label><div className="font-bold text-gray-800 text-lg">{selectedOrder.customerName}</div>{selectedOrder.customerPhone && <div className="text-gray-800 font-medium">{selectedOrder.customerPhone}</div>}<div className="text-gray-600">{selectedOrder.address}</div></div>
                                <div className="flex justify-between border-t border-b border-gray-100 py-4">
                                    <div><label className="text-xs font-bold text-gray-400 uppercase">Giá trị COD</label><div className="font-mono font-bold text-gray-800 text-lg">{(selectedOrder.orderValue || 0).toLocaleString()} đ</div></div>
                                    <div className="text-right"><label className="text-xs font-bold text-gray-400 uppercase">Số lượng</label><div className="text-gray-800">{selectedOrder.items.length} món</div></div>
                                </div>
                            </div>

                            {/* --- PHẦN ẢNH KHI TẠO ĐƠN --- */}
                            <div>
                                <label className="text-xs font-bold text-gray-400 uppercase mb-2 block">Ảnh khi tạo đơn</label>
                                {selectedOrder.orderImage ? (
                                    <div className="group relative rounded-xl overflow-hidden border border-gray-200 shadow-sm bg-gray-900">
                                        <img
                                            src={getDirectDriveUrl(selectedOrder.orderImage)}
                                            alt="Order Creation"
                                            className="w-full h-auto max-h-[600px] object-contain mx-auto"
                                            onError={(e) => {
                                                const target = e.target as HTMLImageElement;
                                                if (!target.src.includes('placehold.co')) {
                                                    target.src = 'https://placehold.co/600x400/png?text=Error+Loading+Image';
                                                }
                                            }}
                                        />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <a
                                                href={selectedOrder.orderImage}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="p-3 bg-white/20 backdrop-blur-md rounded-full text-white hover:bg-white/40 transition-colors"
                                            >
                                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                            </a>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="bg-gray-100 rounded-xl p-4 text-center text-xs text-gray-400 border border-dashed border-gray-300">
                                        Không có ảnh tạo đơn
                                    </div>
                                )}
                            </div>

                            {/* --- PHẦN ẢNH POD --- */}
                            <div>
                                <label className="text-xs font-bold text-gray-400 uppercase mb-2 block">Hình ảnh xác thực (POD)</label>
                                {selectedOrder.proofOfDelivery && selectedOrder.proofOfDelivery.imageUrl ? (
                                    <div className="group relative rounded-xl overflow-hidden border border-gray-200 shadow-sm bg-gray-900">
                                        <img
                                            src={getDirectDriveUrl(selectedOrder.proofOfDelivery.imageUrl)}
                                            alt="Proof of Delivery"
                                            className="w-full h-auto max-h-[600px] object-contain mx-auto"
                                            onError={(e) => {
                                                const target = e.target as HTMLImageElement;
                                                if (!target.src.includes('placehold.co')) {
                                                    target.src = 'https://placehold.co/600x400/png?text=Error+Loading+Image';
                                                }
                                            }}
                                        />

                                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 pt-12 text-white opacity-100 transition-opacity">
                                            <div className="flex items-center justify-between">
                                                <div className="text-xs font-medium space-y-1">
                                                    <div className="flex items-center gap-1.5 text-gray-200">
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                        {new Date(selectedOrder.proofOfDelivery.timestamp || Date.now()).toLocaleString('vi-VN')}
                                                    </div>
                                                    {selectedOrder.proofOfDelivery.address && (
                                                        <div className="flex items-start gap-1.5 text-gray-300 max-w-[250px]">
                                                            <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                                            <span className="line-clamp-2">{selectedOrder.proofOfDelivery.address}</span>
                                                        </div>
                                                    )}
                                                </div>

                                                <a
                                                    href={selectedOrder.proofOfDelivery.imageUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="p-2 bg-white/20 hover:bg-white/30 rounded-full backdrop-blur-sm transition-colors"
                                                    title="Mở ảnh gốc"
                                                >
                                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="bg-gray-100 rounded-xl p-8 text-center text-gray-400 border border-dashed border-gray-300"><svg className="w-10 h-10 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>Chưa có ảnh xác thực</div>
                                )}
                            </div>

                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ManagerDashboard;