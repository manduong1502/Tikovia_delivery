import React, { useState, useEffect, useRef } from 'react';
import { User, Customer } from '../types';
import { searchCustomers, getCustomers, getOrders } from '../services/mockDb';
import CameraCapture from './CameraCapture';
import MapPicker from './MapPicker';

interface CreateOrderFormProps {
    onSubmit: (data: {
        customerName: string;
        customerPhone?: string;
        address: string;
        orderValue: number;
        itemsString: string;
        location?: { lat: number; lng: number };
        orderImage?: string;
        note?: string;
        routeId?: string;
    }) => Promise<void>;
    onCancel: () => void;
    currentUser?: User | null;
}
interface SearchResult {
    place_id: number;
    lat: string;
    lon: string;
    display_name: string;
}
interface QueuedOrder {
    tempId: number;
    customerName: string;
    customerPhone?: string;
    address: string;
    itemsString: string;
    orderValue: number;
    orderValueDisplay: string;
    location?: { lat: number; lng: number };
    orderImage?: string;
    note?: string;
}
const CreateOrderForm: React.FC<CreateOrderFormProps> = ({ onSubmit, onCancel, currentUser }) => {
    // Form Inputs
    const [customerName, setCustomerName] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [address, setAddress] = useState('');
    const [itemsString, setItemsString] = useState('');
    const [orderValue, setOrderValue] = useState('');
    const [orderImage, setOrderImage] = useState<string>('');
    const [routeName, setRouteName] = useState<string>(''); // Tên tuyến chung

    // States
    const [orderQueue, setOrderQueue] = useState<QueuedOrder[]>([]);
    const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lng: number } | undefined>(undefined);
    const [isLoading, setIsLoading] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');
    const [note, setNote] = useState('');

    // Camera States
    const [showCamera, setShowCamera] = useState(false);
    const [isAiProcessing, setIsAiProcessing] = useState(false);
    const isSubmittingRef = useRef(false);
    const formRef = useRef<HTMLFormElement>(null);

    // Address Search State
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Customer Autocomplete State
    const [customerSuggestions, setCustomerSuggestions] = useState<Customer[]>([]);
    const [showCustSuggestions, setShowCustSuggestions] = useState(false);
    // Thêm state cho MapPicker
    const [showMapPicker, setShowMapPicker] = useState(false);

    // --- 1. TẢI DỮ LIỆU KHÁCH HÀNG VÀ TÍNH TOÁN TÊN TUYẾN MẶC ĐỊNH KHI MỞ TRANG ---
    useEffect(() => {
        getCustomers().then((data) => {
            console.log(`Đã tải ${data.length} khách hàng để gợi ý.`);
        });

        const fetchDefaultRoute = async () => {
            try {
                const orders = await getOrders();
                const todayStr = new Date().toDateString();
                const allTodayRoutes = orders.filter(o => {
                    const isToday = new Date(o.createdAt || Date.now()).toDateString() === todayStr;
                    const isMyRoute = currentUser ? o.driverId === currentUser.id : true;
                    return isToday && isMyRoute;
                });
                
                let maxRouteNumber = 0;
                allTodayRoutes.forEach(o => {
                    if (o.routeId && o.routeId.toLowerCase().includes('tuyến')) {
                        const match = o.routeId.match(/tuyến\s*(\d+)/i);
                        if (match && match[1]) {
                            const num = parseInt(match[1]);
                            if (num > maxRouteNumber) maxRouteNumber = num;
                        }
                    }
                });
                
                setRouteName(`Tuyến ${maxRouteNumber + 1}`);
            } catch (e) {
                setRouteName('Tuyến 1');
            }
        };
        fetchDefaultRoute();
    }, []);

    useEffect(() => {
        if (successMsg) {
            const timer = setTimeout(() => setSuccessMsg(''), 3000);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [successMsg]);
    // --- HÀM NÉN ẢNH ---
    const compressImage = (base64Str: string): Promise<string> => {
        return new Promise((resolve) => {
            const img = new Image();
            img.src = base64Str;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 600;
                let width = img.width;
                let height = img.height;
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.6));
            };
        });
    };
    const handleCaptureOrderImage = async (imageData: string) => {
        setShowCamera(false);
        try {
            const compressed = await compressImage(imageData);
            setOrderImage(compressed);
        } catch (e) {
            console.error("Lỗi nén ảnh:", e);
        }
    };
    // --- AI SCAN LOGIC ---

    // --- 2. XỬ LÝ NHẬP TÊN VÀ TÌM KIẾM KHÁCH HÀNG ---
    const handleNameChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setCustomerName(value);

        // Tìm kiếm ngay khi nhập
        if (value.length > 0) {
            const results = await searchCustomers(value);
            setCustomerSuggestions(results);
            setShowCustSuggestions(results.length > 0);
        } else {
            setShowCustSuggestions(false);
        }
    };
    // --- 3. CHỌN KHÁCH HÀNG TỪ GỢI Ý ---
    const selectCustomer = (cust: Customer) => {
        setCustomerName(cust.name);
        setCustomerPhone(cust.phone || '');
        if (cust.address) setAddress(cust.address);
        if (cust.location) {
            setSelectedLocation(cust.location);
        } else {
            setSelectedLocation(undefined);
        }

        setShowCustSuggestions(false);
        setSearchResults([]);
    };
    // Ẩn gợi ý khi click ra ngoài hoặc focus ô khác (dùng setTimeout để click sự kiện kịp chạy)
    const handleNameBlur = () => {
        setTimeout(() => setShowCustSuggestions(false), 200);
    };
    const handleAddressChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        setAddress(value);
        setSelectedLocation(undefined);
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
            }, 500);
        } else {
            setSearchResults([]);
            setShowSuggestions(false);
            setIsSearching(false);
        }
    };
    const selectAddress = (result: SearchResult) => {
        const houseNumberRegex = /^(\d+[\w\/]*)\s/;
        const match = address.match(houseNumberRegex);
        let finalAddress = result.display_name;
        if (match) {
            const prefix = match[1];
            if (!finalAddress.toLowerCase().startsWith(prefix.toLowerCase())) {
                finalAddress = `${prefix} ${finalAddress}`;
            }
        }
        setAddress(finalAddress);
        setSelectedLocation({
            lat: parseFloat(result.lat),
            lng: parseFloat(result.lon)
        });
        setShowSuggestions(false);
    };
    const resetFormInput = () => {
        setCustomerName('');
        setCustomerPhone('');
        setAddress('');
        setItemsString('');
        setOrderValue('');
        setOrderImage('');
        setNote('');
        setSelectedLocation(undefined);
        setSearchResults([]);
        setShowCustSuggestions(false);
    };
    const handleAddToQueue = () => {
        if (formRef.current && !formRef.current.checkValidity()) {
            formRef.current.reportValidity();
            return;
        }
        if (!customerName || !address || !orderValue) return;
        if (!orderImage) {
            alert('Bắt buộc: Vui lòng chụp/tải ảnh đơn hàng trước khi xếp vào hàng chờ!');
            return;
        }
        const newQueueItem: QueuedOrder = {
            tempId: Date.now(),
            customerName,
            customerPhone,
            address,
            itemsString,
            orderValue: parseInt(orderValue.toString().replace(/\D/g, '')),
            orderValueDisplay: orderValue.toString(),
            location: selectedLocation,
            orderImage: orderImage,
            note: note
        };
        setOrderQueue(prev => [newQueueItem, ...prev]);
        resetFormInput();
        setSuccessMsg('Đã thêm vào danh sách chờ!');
    };
    const handleGenerateDemo = () => {
        const demoData = [
            { name: 'Nguyễn Thị Hương', addr: '123 Lê Lợi, Quận 1, TP.HCM', item: 'Mỹ phẩm', val: 550000 },
            { name: 'Trần Văn Nam', addr: '45 Võ Văn Tần, Quận 3, TP.HCM', item: 'Giày thể thao', val: 1200000 },
        ];
        const newItems = demoData.map((d, i) => ({
            tempId: Date.now() + i,
            customerName: d.name,
            customerPhone: '0901234567',
            address: d.addr,
            itemsString: d.item,
            orderValue: d.val,
            orderValueDisplay: d.val.toString(),
            location: undefined
        }));
        setOrderQueue(prev => [...newItems, ...prev]);
        setSuccessMsg('Đã tạo đơn hàng mẫu!');
    };
    const removeFromQueue = (tempId: number) => {
        setOrderQueue(prev => prev.filter(item => item.tempId !== tempId));
    };
    const handleSubmitAll = async () => {
        if (isSubmittingRef.current || isLoading) return;

        const finalRouteId = routeName.trim() || 'Tuyến 1';

        const numOrders = orderQueue.length > 0 ? orderQueue.length : 1;
        const confirmMsg = `Bạn đang chuẩn bị lưu ${finalRouteId} gồm ${numOrders} đơn hàng.\n\nBấm [OK - Xác nhận] để Lưu Tuyến.\nBấm [Hủy] nếu bạn muốn Xếp thêm đơn vào hàng chờ trước khi lưu.`;
        if (!window.confirm(confirmMsg)) {
            return;
        }

        if (orderQueue.length === 0 && customerName && address) {
            if (!orderImage) {
                alert('Bắt buộc: Vui lòng chụp/tải ảnh đơn hàng trước khi lưu!');
                return;
            }
            isSubmittingRef.current = true;
            setIsLoading(true);
            try {
                await onSubmit({
                    customerName,
                    customerPhone,
                    address,
                    orderValue: parseInt(orderValue.toString().replace(/\D/g, '')),
                    itemsString,
                    location: selectedLocation,
                    orderImage: orderImage,
                    note: note,
                    routeId: finalRouteId
                });
                resetFormInput();
                setSuccessMsg('Đã lưu đơn hàng tuyến mới!');
            } catch (e) { console.error(e) }
            finally { setIsLoading(false); isSubmittingRef.current = false; }
            return;
        }
        isSubmittingRef.current = true;
        setIsLoading(true);
        try {
            for (const item of orderQueue) {
                await onSubmit({
                    customerName: item.customerName,
                    customerPhone: item.customerPhone, // Bổ sung sđt bị thiếu
                    address: item.address,
                    orderValue: item.orderValue,
                    itemsString: item.itemsString,
                    location: item.location,
                    orderImage: item.orderImage,
                    note: item.note,
                    routeId: finalRouteId
                });
            }
            setOrderQueue([]);
            setSuccessMsg(`Đã tạo Tuyến gồm ${orderQueue.length} đơn!`);
        } catch (e) {
            console.error("Batch submit failed", e);
        } finally {
            setIsLoading(false);
            isSubmittingRef.current = false;
        }
    };
    if (showMapPicker) {
        return (
            <MapPicker
                onLocationSelected={(location, addr) => {
                    setAddress(addr);
                    setSelectedLocation(location);
                    setShowMapPicker(false);
                }}
                onCancel={() => setShowMapPicker(false)}
                initialLocation={selectedLocation} // Optional, để giữ vị trí cũ nếu có
            />
        );
    }
    if (showCamera) {
        return <CameraCapture onCapture={handleCaptureOrderImage} onCancel={() => setShowCamera(false)} />;
    }
    return (
        <div className="flex flex-col h-full bg-gray-50 relative">
            {/* Toast Notification */}
            {successMsg && (
                <div className="fixed top-4 left-4 right-4 bg-blue-600 text-white px-4 py-3 rounded-xl shadow-2xl z-[60] flex items-center gap-3 animate-slide-down">
                    <div className="bg-white/20 p-1.5 rounded-full">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <span className="font-bold text-sm">{successMsg}</span>
                </div>
            )}
            {/* Header */}
            <div className="bg-white pt-9 p-4 shadow-sm flex items-center justify-between sticky top-0 z-10 border-b border-gray-100 flex-none">
                <button onClick={onCancel} className="text-gray-500 font-medium px-4 py-2 bg-gray-100 rounded-full">Đóng</button>
                <h1 className="font-bold text-gray-800">
                    {orderQueue.length > 0 ? `Tuyến chờ (${orderQueue.length} đơn)` : 'Tạo tuyến mới'}
                </h1>
                <div className="w-8"></div>
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar">
                <div className="p-4 space-y-6">

                    {/* Input Form Section */}
                    <form
                        ref={formRef}
                        className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4"
                        onSubmit={(e) => e.preventDefault()}
                    >
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Nhập liệu thông minh</h3>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowCamera(true)}
                                    className={`text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 border transition-all
                                ${orderImage
                                            ? 'text-green-600 bg-green-50 border-green-200'
                                            : 'text-blue-600 bg-blue-50 border-blue-100 hover:bg-blue-100'}`}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                    {orderImage ? 'Đã có ảnh' : 'Chụp ảnh'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleGenerateDemo}
                                    className="text-xs font-bold text-gray-600 bg-gray-50 px-3 py-1.5 rounded-lg hover:bg-gray-100 flex items-center gap-1.5 border border-gray-100"
                                >
                                    Mẫu
                                </button>
                            </div>
                        </div>
                        {isAiProcessing && (
                            <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 animate-pulse flex items-center gap-3">
                                <div className="w-8 h-8 bg-purple-200 rounded-full flex items-center justify-center">
                                    <svg className="w-5 h-5 text-purple-600 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                </div>
                                <span className="text-sm font-bold text-purple-700">Gemini đang phân tích hóa đơn...</span>
                            </div>
                        )}

                        {orderImage && (
                            <div className="relative inline-block mb-2">
                                <img src={orderImage} alt="Order Preview" className="w-20 h-20 object-cover rounded-lg border border-gray-200 shadow-sm" />
                                <button
                                    type="button"
                                    onClick={() => setOrderImage('')}
                                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                        )}

                        <div className="relative z-[55] mb-2 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                            <label className="block text-xs font-bold text-blue-700 mb-1.5 uppercase">Tên Tuyến (Tùy chọn)</label>
                            <input
                                type="text"
                                value={routeName}
                                onChange={e => setRouteName(e.target.value)}
                                placeholder="VD: Tuyến Ninh Kiều, Trả sáng..."
                                className="w-full p-2.5 bg-white border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none text-blue-900 font-bold"
                            />
                        </div>

                        <div className="relative z-50">
                            <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">Khách hàng</label>
                            <input
                                id="customerNameInput"
                                required
                                type="text"
                                value={customerName}
                                onChange={handleNameChange}
                                onBlur={handleNameBlur} // Dùng hàm mới có timeout
                                placeholder="Tên khách hàng"
                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold text-gray-800"
                                autoComplete="off"
                            />
                            {/* LIST GỢI Ý KHÁCH HÀNG */}
                            {showCustSuggestions && customerSuggestions.length > 0 && (
                                <ul className="absolute z-60 w-full bg-white border border-gray-200 rounded-xl shadow-xl mt-1 max-h-60 overflow-y-auto">
                                    {customerSuggestions.map((cust) => (
                                        <li key={cust.id} onClick={() => selectCustomer(cust)} className="p-3 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0">
                                            <div className="flex justify-between">
                                                <div className="font-bold text-gray-800 text-sm">{cust.name}</div>
                                                {cust.phone && <div className="text-xs text-gray-400">{cust.phone}</div>}
                                            </div>
                                            <div className="text-[11px] text-gray-500 truncate mt-0.5">{cust.address}</div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <div className="relative z-45">
                            <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">Số điện thoại</label>
                            <input
                                type="tel"
                                value={customerPhone}
                                onChange={(e) => setCustomerPhone(e.target.value)}
                                placeholder="090..."
                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium text-gray-800"
                            />
                        </div>
                        <div className="relative z-40">
                            <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">Địa chỉ</label>
                            <textarea
                                required
                                rows={2}
                                value={address}
                                onChange={handleAddressChange}
                                placeholder="Số nhà, đường, phường..."
                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium text-gray-700"
                            />
                            {showSuggestions && searchResults.length > 0 && (
                                <ul className="absolute z-50 w-full bg-white border border-gray-200 rounded-xl shadow-xl mt-1 max-h-60 overflow-y-auto">
                                    {searchResults.map((result) => (
                                        <li key={result.place_id} onClick={() => selectAddress(result)} className="p-3 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0 flex items-start gap-3">
                                            <svg className="w-4 h-4 text-gray-400 flex-none mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                            <span className="text-xs text-gray-700 font-medium">{result.display_name}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {/* Thêm nút chọn trên bản đồ */}
                            <button
                                type="button"
                                onClick={() => setShowMapPicker(true)}
                                className="mt-2 w-full bg-green-50 hover:bg-green-100 text-green-700 font-bold py-2.5 rounded-xl border border-green-200 flex items-center justify-center gap-2 transition-all"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                Chọn vị trí trên bản đồ (chính xác hơn)
                            </button>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">Ghi chú</label>
                            <textarea
                                rows={2}
                                value={note}
                                onChange={e => setNote(e.target.value)}
                                placeholder="Ghi chú đơn hàng (VD: Giao giờ hành chính...)"
                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-medium text-gray-700"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">Sản phẩm</label>
                                <input type="text" value={itemsString} onChange={e => setItemsString(e.target.value)} placeholder="Tên hàng" className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-medium text-gray-700" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">COD (VND)</label>
                                <input required type="text" inputMode="numeric" value={orderValue} onChange={e => {
                                    const raw = e.target.value.replace(/\D/g, '');
                                    setOrderValue(raw ? parseInt(raw, 10).toLocaleString('en-US') : '');
                                }} placeholder="0" className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-800" />
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleAddToQueue}
                            className="w-full py-3 bg-gray-50 hover:bg-gray-100 text-gray-600 font-bold rounded-xl border border-gray-200 flex items-center justify-center gap-2 transition-all active:scale-95"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                            Xếp vào hàng chờ
                        </button>
                    </form>
                    {/* Queue List Display */}
                    {orderQueue.length > 0 && (
                        <div className="space-y-3 pb-4 px-1">
                            <div className="flex items-center justify-between px-1">
                                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Hàng chờ ({orderQueue.length})</h3>
                                <button onClick={() => setOrderQueue([])} className="text-[10px] font-bold text-red-400 hover:text-red-500 uppercase tracking-widest">Xóa hết</button>
                            </div>

                            {orderQueue.map((item) => (
                                <div key={item.tempId} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center group animate-slide-up">
                                    <div className="flex-1 mr-4">
                                        <div className="font-bold text-gray-800">{item.customerName}</div>
                                        <div className="text-[11px] text-gray-500 line-clamp-1 mt-0.5">{item.address}</div>
                                        <div className="text-sm font-bold text-blue-600 mt-1.5 flex items-center gap-2">
                                            {parseInt(item.orderValueDisplay).toLocaleString()} đ
                                            {item.orderImage && (
                                                <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded border border-green-200 font-bold">Có ảnh</span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => removeFromQueue(item.tempId)}
                                        className="text-gray-300 hover:text-red-500 p-2 rounded-full hover:bg-red-50 transition-all"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            {/* Footer Actions */}
            <div className="p-4 border-t border-gray-100 pb-safe bg-white flex-none shadow-[0_-4px_10px_rgba(0,0,0,0.02)]">
                <button
                    type="button"
                    onClick={handleSubmitAll}
                    disabled={isLoading || (orderQueue.length === 0 && (!customerName || !address))}
                    className={`w-full py-4 rounded-2xl font-bold text-white shadow-xl flex items-center justify-center gap-2 transition-all
                ${(isLoading || (orderQueue.length === 0 && !customerName))
                            ? 'bg-gray-300 cursor-not-allowed shadow-none'
                            : 'bg-blue-600 hover:bg-blue-700 active:scale-95 shadow-blue-200'}
            `}
                >
                    {isLoading ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                        <>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            {orderQueue.length > 0
                                ? `Lưu Tuyến (${orderQueue.length} đơn)`
                                : 'Lưu đơn này'}
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};
export default CreateOrderForm;