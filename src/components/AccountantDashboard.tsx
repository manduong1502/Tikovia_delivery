import React, { useState, useEffect, useRef } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Order, OrderStatus } from '../types';
import { getCurrentUser, getShiftReports, getExpenses, saveExpenses, confirmShiftReport } from '../services/authService';
import { subscribeToDrivers } from '../services/trackingService';
import { getOrders } from '../services/mockDb';
import { APP_CONFIG } from '../../config';
import CameraCapture from './CameraCapture';

interface AccountantDashboardProps {
    orders: Order[];
    onBack: () => void;
}

interface ExpenseRow {
    id: string;
    note: string;
    amount: string;
    image: string;
}

const statusLabels: Record<OrderStatus, string> = {
    [OrderStatus.ASSIGNED]: 'Đã gán',
    [OrderStatus.DELIVERING]: 'Đang giao',
    [OrderStatus.ARRIVED]: 'Đã đến',
    [OrderStatus.DELIVERED]: 'Hoàn tất',
    [OrderStatus.CANCELED]: 'Đã hủy'
};

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
                return `https://drive.google.com/thumbnail?id=${id}&sz=w1000`;
            }
        } catch (e) {
            return url;
        }
    }
    return url;
};

// --- HÀM KIỂM TRA NGÀY HÔM NAY CHỐNG LỖI ĐỊNH DẠNG ---
const isToday = (dateInput: any) => {
    if (!dateInput) return false;
    let dateObj: Date | null = null;
    
    const dateString = String(dateInput).trim();
    if (dateString.includes('/')) {
        // "15:21:02 13/3/2026" or "13/03/2026"
        let parts = dateString.split(/[ \/:]+/);
        
        // if starts with time (like "15 21 02 13 3 2026")
        if (dateString.includes(':') && parts.length >= 6) {
            // Check if first part looks like hour or day
            if (dateString.indexOf(':') < dateString.indexOf('/')) {
                // "15:21:02 13/3/2026" -> [15, 21, 02, 13, 3, 2026]
                const day = parseInt(parts[3], 10);
                const month = parseInt(parts[4], 10) - 1;
                const year = parseInt(parts[5], 10);
                dateObj = new Date(year, month, day, parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10));
            } else {
                // "13/3/2026 15:21:02" -> [13, 3, 2026, 15, 21, 02]
                const day = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10) - 1;
                const year = parseInt(parts[2], 10);
                dateObj = new Date(year, month, day, parseInt(parts[3], 10), parseInt(parts[4], 10), parseInt(parts[5], 10));
            }
        } 
        // "13/03/2026"
        else if (parts.length >= 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const year = parseInt(parts[2], 10);
            dateObj = new Date(year, month, day);
        } else {
            dateObj = new Date(dateString);
        }
    } else {
         dateObj = new Date(dateInput);
    }

    if (!dateObj || isNaN(dateObj.getTime())) {
        return false;
    }

    const today = new Date();
    return dateObj.getDate() === today.getDate() &&
        dateObj.getMonth() === today.getMonth() &&
        dateObj.getFullYear() === today.getFullYear();
};

const AccountantDashboard: React.FC<AccountantDashboardProps> = ({ orders: initialOrders, onBack }) => {
    const currentUser = getCurrentUser();
    const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'MAP' | 'SHIFT_REPORTS' | 'EXPENSES' | 'SUMMARY'>('OVERVIEW');
    const [liveDrivers, setLiveDrivers] = useState<any[]>([]);

    // Data states
    const [ordersData, setOrdersData] = useState<Order[]>(initialOrders);
    const [shiftReports, setShiftReports] = useState<any[]>([]);
    const [expensesList, setExpensesList] = useState<any[]>([]);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [confirmingId, setConfirmingId] = useState<string | null>(null);
    const [previewImages, setPreviewImages] = useState<string[]>([]); // Sửa thành mảng để xem nhiều ảnh
    const [currentPreviewIndex, setCurrentPreviewIndex] = useState<number>(0);

    // Expense Form states
    const [expenseRows, setExpenseRows] = useState<ExpenseRow[]>([{ id: Date.now().toString(), note: '', amount: '', image: '' }]);
    const [activeCameraRow, setActiveCameraRow] = useState<string | null>(null);
    const [isSavingExpense, setIsSavingExpense] = useState(false);
    const [expenseMessage, setExpenseMessage] = useState('');

    const [isSavingSummary, setIsSavingSummary] = useState(false);
    const [summaryMessage, setSummaryMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);

    useEffect(() => {
        setOrdersData(initialOrders);
    }, [initialOrders]);

    // --- FETCH DATA LIÊN TỤC ---
    const fetchAccountingData = async () => {
        setIsRefreshing(true);
        try {
            const [reports, exps, latestOrders] = await Promise.all([
                getShiftReports(),
                getExpenses(),
                getOrders()
            ]);
            // Ép kiểu mảng để chống lỗi nếu API chưa sẵn sàng
            setShiftReports(Array.isArray(reports) ? reports : []);
            setExpensesList(Array.isArray(exps) ? exps : []);
            if (Array.isArray(latestOrders)) setOrdersData(latestOrders);
        } catch (error) {
            console.error("Lỗi lấy dữ liệu kế toán:", error);
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleConfirmReportsByDriver = async (driverName: string, reportIds: string[]) => {
        setConfirmingId(driverName);
        try {
            for (const id of reportIds) {
                await confirmShiftReport(id);
            }
            fetchAccountingData(); // Load lại dữ liệu ngay lập tức
        } catch (error) {
            alert("Lỗi xác nhận: " + error);
        } finally {
            setConfirmingId(null);
        }
    };

    useEffect(() => {
        fetchAccountingData();
        const interval = setInterval(fetchAccountingData, 10000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (activeTab === 'MAP') {
            const unsubscribe = subscribeToDrivers((data) => {
                setLiveDrivers(data);
            });
            return () => unsubscribe();
        }
        return;
    }, [activeTab]);

    useEffect(() => {
        if (activeTab === 'MAP' && mapContainerRef.current && !mapInstanceRef.current) {
            const centerLat = ordersData.length > 0 ? ordersData[0].location.lat : 16.0123;
            const centerLng = ordersData.length > 0 ? ordersData[0].location.lng : 108.2133;

            const map = L.map(mapContainerRef.current).setView([centerLat, centerLng], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© OpenStreetMap'
            }).addTo(map);

            setTimeout(() => {
                try {
                    map.invalidateSize(true);
                    const todayMapOrders = ordersData.filter(o => isToday(o.createdAt));
                    if (todayMapOrders.length > 0) {
                        const bounds = L.latLngBounds(todayMapOrders.map(o => [o.location.lat, o.location.lng]));
                        map.fitBounds(bounds, { padding: [50, 50] });
                    }
                } catch (e) { console.warn('fitBounds failed', e); }
            }, 300);

            mapInstanceRef.current = map;
        }

        if (activeTab === 'MAP' && mapInstanceRef.current) {
            const map = mapInstanceRef.current;
            map.eachLayer((layer: any) => {
                if (layer instanceof L.Marker) map.removeLayer(layer);
            });

            const markers = L.featureGroup();
            const todayMapOrders = ordersData.filter(o => isToday(o.createdAt));
            todayMapOrders.forEach((order: Order) => {
                let color = '#3b82f6';
                if (order.status === OrderStatus.DELIVERED) color = '#22c55e';
                if (order.status === OrderStatus.ASSIGNED) color = '#9ca3af';
                if (order.status === OrderStatus.ARRIVED) color = '#a855f7';

                const markerHtml = `<div style="background-color: ${color}; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3); color: white; font-weight: bold; font-size: 10px;">${order.status === OrderStatus.DELIVERED ? '✓' : ''}</div>`;
                const icon = L.divIcon({ className: 'custom-pin', html: markerHtml, iconSize: [24, 24], iconAnchor: [12, 12] });

                const marker = L.marker([order.location.lat, order.location.lng], { icon })
                    .bindPopup(`<b>${order.id}</b><br/>Tài xế: ${order.driverName}<br/>COD: ${(order.orderValue || 0).toLocaleString()}đ`);
                markers.addLayer(marker);
            });
            if (todayMapOrders.length > 0) markers.addTo(map);

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
                        .bindPopup(`<b>${driver.name}</b><br/>Đang giao: ${driver.orderId || 'Trống'}`)
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
    }, [activeTab, ordersData, liveDrivers]);

    // --- TÍNH TOÁN DATA ---
    const todayOrders = ordersData.filter(o => isToday(o.createdAt));
    const totalRevenue = todayOrders.reduce((sum, o) => sum + (o.codTransaction?.amount || 0), 0);
    const pendingRevenue = todayOrders.filter(o => o.status !== OrderStatus.DELIVERING && o.status !== OrderStatus.CANCELED).reduce((sum, o) => sum + (o.orderValue || 0), 0);
    const statusCounts = todayOrders.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc; }, {} as Record<string, number>);
    const activeDriversCount = new Set(todayOrders.filter(o => o.status === OrderStatus.DELIVERING || o.status === OrderStatus.ASSIGNED).map(o => o.driverName)).size;

    // Sử dụng mảng an toàn
    const safeShiftReports = Array.isArray(shiftReports) ? shiftReports : [];
    const safeExpensesList = Array.isArray(expensesList) ? expensesList : [];

    const todaysReports = safeShiftReports.filter(r => isToday(r.timestamp));
    const totalTodayShiftMoney = todaysReports.reduce((sum, r) => sum + (Number(r.totalCOD) || 0) - (Number(r.additionalFee) || 0), 0);

    // Group reports by driverName
    const reportsByDriver = todaysReports.reduce((acc, report) => {
        const name = report.driverName || 'Khác';
        if (!acc[name]) {
            acc[name] = { 
                driverName: name, 
                reports: [], 
                totalThucNop: 0, 
                totalCOD: 0, 
                totalFee: 0, 
                images: [], 
                idList: [], 
                allConfirmed: true 
            };
        }
        
        acc[name].reports.push(report);
        acc[name].totalCOD += (Number(report.totalCOD) || 0);
        acc[name].totalFee += (Number(report.additionalFee) || 0);
        
        const thucNop = (Number(report.totalCOD) || 0) - (Number(report.additionalFee) || 0);
        acc[name].totalThucNop += thucNop;
        acc[name].idList.push(report.id);
        
        if (report.status !== 'Đã xác nhận') {
            acc[name].allConfirmed = false;
        }
        
        if (report.feeImage) acc[name].images.push(report.feeImage);
        if (report.shiftImages) {
            if (Array.isArray(report.shiftImages)) {
                acc[name].images.push(...report.shiftImages);
            } else if (typeof report.shiftImages === 'string') {
                const str = report.shiftImages;
                if (str.startsWith('[')) {
                    try { acc[name].images.push(...JSON.parse(str)); } catch(e){}
                } else {
                    acc[name].images.push(...str.split(/[\n,]+/).map((i: string)=>i.trim()).filter(Boolean));
                }
            }
        }
        if (report.shiftImage) acc[name].images.push(report.shiftImage);

        return acc;
    }, {} as Record<string, any>);
    
    const groupedReports = Object.values(reportsByDriver) as Array<{ driverName: string, reports: any[], totalThucNop: number, totalCOD: number, totalFee: number, images: string[], idList: string[], allConfirmed: boolean }>;
    // --- XỬ LÝ NHẬP CHI TIÊU ĐỘNG ---
    const handleExpenseChange = (index: number, field: keyof ExpenseRow, value: string) => {
        const newRows = [...expenseRows];
        newRows[index][field] = value;
        setExpenseRows(newRows);

        if (index === expenseRows.length - 1 && value !== '') {
            setExpenseRows([...newRows, { id: Date.now().toString(), note: '', amount: '', image: '' }]);
        }
    };

    const handleRemoveExpenseRow = (id: string) => {
        if (expenseRows.length === 1) return;
        setExpenseRows(expenseRows.filter(r => r.id !== id));
    };

    const handleExpenseImageCapture = async (imageData: string) => {
        if (activeCameraRow) {
            const newRows = expenseRows.map(row =>
                row.id === activeCameraRow ? { ...row, image: imageData } : row
            );
            setExpenseRows(newRows);
        }
        setActiveCameraRow(null);
    };

    const submitExpenses = async () => {
        const validExpenses = expenseRows.filter(r => r.note.trim() !== '' && (parseInt(String(r.amount).replace(/\D/g, '')) || 0) > 0);
        if (validExpenses.length === 0) {
            setExpenseMessage('Vui lòng nhập ít nhất 1 khoản chi hợp lệ');
            setTimeout(() => setExpenseMessage(''), 3000);
            return;
        }

        setIsSavingExpense(true);
        try {
            const formattedExpenses = validExpenses.map(e => ({
                note: e.note,
                amount: parseInt(String(e.amount).replace(/\D/g, '')) || 0,
                image: e.image,
                timestamp: new Date().toLocaleString('vi-VN')
            }));

            await saveExpenses(formattedExpenses, currentUser?.fullName || "Kế toán");
            setExpenseMessage('Lưu khoản chi thành công!');
            setExpenseRows([{ id: Date.now().toString(), note: '', amount: '', image: '' }]);
            fetchAccountingData();
        } catch (error) {
            setExpenseMessage('Lỗi khi lưu. Vui lòng thử lại.');
        } finally {
            setIsSavingExpense(false);
            setTimeout(() => setExpenseMessage(''), 3000);
        }
    };

    // --- TỔNG KẾT DÒNG TIỀN ---
    const calculateSummary = () => {
        let totalThuAllTime = 0;
        let totalChiAllTime = 0;
        let totalThuToday = 0;
        let totalChiToday = 0;

        safeShiftReports.forEach(r => {
            const amount = (Number(r.totalCOD) || 0) - (Number(r.additionalFee) || 0);
            totalThuAllTime += amount;
            if (isToday(r.timestamp)) {
                totalThuToday += amount;
            }
        });

        safeExpensesList.forEach(e => {
            const amount = Number(e.amount) || 0;
            totalChiAllTime += amount;
            if (isToday(e.timestamp)) {
                totalChiToday += amount;
            }
        });

        const previousBalance = (totalThuAllTime - totalThuToday) - (totalChiAllTime - totalChiToday);
        const currentBalance = totalThuAllTime - totalChiAllTime;

        return {
            todayThu: totalThuToday,
            todayChi: totalChiToday,
            previousBalance,
            currentBalance
        };
    };

    const handleSaveSummary = async () => {
        if (!window.confirm('Bạn có chắc muốn lưu tồn quỹ hôm nay vào hệ thống không?')) return;
        
        setIsSavingSummary(true);
        setSummaryMessage(null);
        
        const currentData = calculateSummary();
        
        const payload = {
            action: 'saveDailySummary',
            date: new Date().toLocaleString('vi-VN'),
            previousBalance: currentData.previousBalance,
            totalThu: currentData.todayThu,
            totalChi: currentData.todayChi,
            currentBalance: currentData.currentBalance,
            accountantName: currentUser?.fullName || "Kế toán"
        };

        try {
            const response = await fetch(APP_CONFIG.GOOGLE_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                setSummaryMessage({ type: 'success', text: 'Chốt sổ hôm nay thành công!' });
                localStorage.setItem('lastSummaryDate', new Date().toLocaleDateString('vi-VN'));
            } else {
                throw new Error(result.message || 'Lỗi lưu dữ liệu');
            }
        } catch (error) {
            setSummaryMessage({ type: 'error', text: 'Lỗi không thể chốt sổ, vui lòng thử lại.' });
        } finally {
            setIsSavingSummary(false);
            setTimeout(() => setSummaryMessage(null), 5000);
        }
    };

    const summaryData = calculateSummary();
    const todayStrDisplay = new Date().toLocaleDateString('vi-VN');
    const isAlreadySavedSummary = localStorage.getItem('lastSummaryDate') === todayStrDisplay;

    if (activeCameraRow) {
        return <CameraCapture onCapture={handleExpenseImageCapture} onCancel={() => setActiveCameraRow(null)} />;
    }

    return (
        <div className="flex flex-col h-full bg-gray-50 relative">
            <div className="bg-white pt-9 pr-4 pl-4 pb-4 shadow-sm flex items-center justify-between sticky top-0 z-10 border-b border-gray-100 flex-none">
                <div className="flex flex-col">
                    <h1 className="font-bold text-gray-800 text-lg">Kế toán viên</h1>
                    <span className="text-xs text-gray-500 font-medium">Xin chào, {currentUser?.fullName}</span>
                </div>
                <button onClick={onBack} className="text-red-500 font-medium text-sm flex items-center gap-1 bg-red-50 px-4 py-2 rounded-full transition-colors active:scale-95">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                    Đăng xuất
                </button>
            </div>

            <div className="flex bg-white border-b border-gray-200 overflow-x-auto no-scrollbar flex-none">
                <button onClick={() => setActiveTab('OVERVIEW')} className={`px-4 py-3 text-[13px] font-bold border-b-2 whitespace-nowrap transition-colors ${activeTab === 'OVERVIEW' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>Tổng quan</button>
                <button onClick={() => setActiveTab('MAP')} className={`px-4 py-3 text-[13px] font-bold border-b-2 whitespace-nowrap transition-colors ${activeTab === 'MAP' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>Bản đồ Live</button>
                <button onClick={() => setActiveTab('SHIFT_REPORTS')} className={`px-4 py-3 text-[13px] font-bold border-b-2 whitespace-nowrap transition-colors ${activeTab === 'SHIFT_REPORTS' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>Chốt ca</button>
                <button onClick={() => setActiveTab('EXPENSES')} className={`px-4 py-3 text-[13px] font-bold border-b-2 whitespace-nowrap transition-colors ${activeTab === 'EXPENSES' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>Tổng chi</button>
                <button onClick={() => setActiveTab('SUMMARY')} className={`px-4 py-3 text-[13px] font-bold border-b-2 whitespace-nowrap transition-colors ${activeTab === 'SUMMARY' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>Tổng kết</button>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
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
                                <span className={`text-xs font-normal text-gray-500 ${isRefreshing ? 'animate-pulse text-blue-500' : ''}`}>Cập nhật tự động</span>
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

                {activeTab === 'MAP' && (
                    <div className="p-4 h-[calc(100vh-160px)]">
                        <div id="accountant-map" ref={mapContainerRef} className="w-full h-full rounded-xl overflow-hidden border border-gray-200 shadow-inner z-0" style={{ minHeight: '60vh' }} />
                    </div>
                )}

                {activeTab === 'SHIFT_REPORTS' && (
                    <div className="p-4 space-y-4">
                        <div className="bg-blue-600 rounded-2xl p-5 text-white shadow-lg shadow-blue-200 flex items-center justify-between">
                            <div>
                                <h2 className="text-blue-100 text-sm font-bold uppercase tracking-wider mb-1">Tổng nộp chốt ca (Hôm nay)</h2>
                                <div className="text-3xl font-extrabold">{totalTodayShiftMoney.toLocaleString()} <span className="text-lg font-normal">đ</span></div>
                            </div>
                            <div className="bg-white/20 p-3 rounded-full">
                                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                        </div>

                        <div className="flex justify-between items-center px-1 pt-2">
                            <h3 className="font-bold text-gray-800">Danh sách chốt ca hôm nay</h3>
                            <button onClick={fetchAccountingData} className="text-xs text-blue-600 font-bold bg-blue-50 px-3 py-1.5 rounded-full flex items-center gap-1">
                                <svg className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                Làm mới
                            </button>
                        </div>

                        {todaysReports.length === 0 ? (
                            <div className="text-center py-10 bg-white rounded-xl border border-gray-100">
                                <p className="text-gray-400 font-medium">Chưa có tài xế nào chốt ca hôm nay</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {groupedReports.map((group, idx) => (
                                    <div key={idx} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <div className="font-bold text-gray-800 text-lg flex items-center gap-2">
                                                    <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                                    </div>
                                                    {group.driverName}
                                                </div>
                                                <div className="text-xs text-gray-500 font-medium ml-10">Tiếp nhận {group.reports.length} bản báo cáo tuyến</div>
                                            </div>
                                            {group.allConfirmed ? (
                                                <div className="bg-green-50 text-green-700 font-bold px-3 py-1.5 rounded-lg text-xs border border-green-100 flex items-center gap-1">
                                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                                                    Đã duyệt hết
                                                </div>
                                            ) : (
                                                <div className="bg-orange-50 text-orange-600 font-bold px-3 py-1.5 rounded-lg text-xs border border-orange-100 animate-pulse">
                                                    Chờ Kế toán duyệt
                                                </div>
                                            )}
                                        </div>

                                        <div className="mb-4 space-y-2">
                                            {group.reports.map((r: any, rIdx: number) => {
                                                if (r.routeBreakdown && Array.isArray(r.routeBreakdown)) {
                                                    return r.routeBreakdown.map((bDown: any, bIdx: number) => (
                                                        <div key={`${rIdx}-${bIdx}`} className="flex justify-between items-center bg-gray-50 px-3 py-2.5 rounded-xl border border-gray-100 shadow-sm">
                                                            <div className="flex items-center gap-2">
                                                                 <div className="w-1.5 h-4 bg-emerald-500 rounded-full"></div>
                                                                 <span className="font-bold text-gray-700 text-[13px]">{bDown.routeName || `Báo cáo tuyến ${bIdx + 1}`}</span>
                                                            </div>
                                                            <span className="font-bold text-blue-600">{(Number(bDown.cod) || 0).toLocaleString()}đ</span>
                                                        </div>
                                                    ));
                                                } else {
                                                    const routeName = (r.shiftName || '').replace('Nộp tuyến:', '').trim();
                                                    return (
                                                        <div key={rIdx} className="flex justify-between items-center bg-gray-50 px-3 py-2.5 rounded-xl border border-gray-100 shadow-sm">
                                                            <div className="flex items-center gap-2">
                                                                 <div className="w-1.5 h-4 bg-blue-500 rounded-full"></div>
                                                                 <span className="font-bold text-gray-700 text-[13px]">{routeName || `Báo cáo tuyến ${rIdx + 1}`}</span>
                                                            </div>
                                                            <span className="font-bold text-blue-600">{(Number(r.totalCOD) || 0).toLocaleString()}đ</span>
                                                        </div>
                                                    );
                                                }
                                            })}
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 text-sm bg-gray-50 p-4 rounded-xl border border-gray-100 mb-4">
                                            <div className="text-gray-500 font-medium">Tổng thu hộ:</div>
                                            <div className="text-right font-bold text-gray-800">{(group.totalCOD).toLocaleString()}đ</div>

                                            <div className="text-gray-500 font-medium flex items-center gap-1">Phí phát sinh:</div>
                                            <div className="text-right font-bold text-red-500">-{(group.totalFee).toLocaleString()}đ</div>
                                        </div>

                                        <div className="flex justify-between items-center mb-4">
                                            <div className="text-sm font-bold text-gray-600 uppercase tracking-wide">Tiền nhận về:</div>
                                            <div className="text-2xl font-black text-blue-600 tracking-tight">{group.totalThucNop.toLocaleString()}đ</div>
                                        </div>

                                        <div className="pt-4 border-t border-gray-100 flex gap-3">
                                            {group.images && group.images.length > 0 && (
                                                <button onClick={() => { setPreviewImages(group.images); setCurrentPreviewIndex(0); }} className="flex-1 bg-white border-2 border-gray-100 text-gray-700 text-center py-3 rounded-xl text-[13px] font-bold hover:bg-gray-50 hover:border-blue-200 hover:text-blue-600 transition-all flex items-center justify-center gap-2">
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                                    Hóa đơn ({group.images.length})
                                                </button>
                                            )}

                                            {!group.allConfirmed && (
                                                <button
                                                    onClick={() => handleConfirmReportsByDriver(group.driverName, group.idList)}
                                                    disabled={confirmingId === group.driverName}
                                                    className={`flex-[1.5] text-white py-3 rounded-xl text-[13px] font-bold transition-all flex items-center justify-center gap-2 shadow-lg
                                                    ${confirmingId === group.driverName ? 'bg-gray-400 cursor-not-allowed shadow-none' : 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 active:scale-95'}`}
                                                >
                                                    {confirmingId === group.driverName ? (
                                                        <><div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin"></div> Đang chốt sổ...</>
                                                    ) : (
                                                        <><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>Chốt ca toàn bộ</>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'EXPENSES' && (
                    <div className="p-4 space-y-4">
                        <div className="flex justify-between items-center">
                            <h2 className="font-bold text-gray-800 text-lg">Kê khai khoản chi</h2>
                            <span className="text-xs text-gray-400 italic"></span>
                        </div>

                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <div className="grid grid-cols-12 gap-2 bg-gray-50 p-3 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
                                <div className="col-span-6">Nội dung chi</div>
                                <div className="col-span-4 text-right">Số tiền (đ)</div>
                                <div className="col-span-2 text-center">Ảnh</div>
                            </div>

                            <div className="divide-y divide-gray-100 p-2">
                                {expenseRows.map((row, index) => (
                                    <div key={row.id} className="grid grid-cols-12 gap-2 items-center py-2 relative group">
                                        <div className="col-span-6">
                                            <input
                                                type="text"
                                                placeholder="VD: Đổ xăng..."
                                                value={row.note}
                                                onChange={(e) => handleExpenseChange(index, 'note', e.target.value)}
                                                className="w-full text-sm p-2 border-b-2 border-transparent hover:border-gray-200 focus:border-blue-500 focus:bg-blue-50/30 rounded outline-none transition-all"
                                            />
                                        </div>
                                        <div className="col-span-4">
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                placeholder="0"
                                                value={row.amount}
                                                onChange={(e) => {
                                                    const raw = e.target.value.replace(/\D/g, '');
                                                    handleExpenseChange(index, 'amount', raw ? parseInt(raw, 10).toLocaleString('en-US') : '');
                                                }}
                                                className="w-full text-sm font-mono font-bold text-right p-2 border-b-2 border-transparent hover:border-gray-200 focus:border-blue-500 focus:bg-blue-50/30 rounded outline-none transition-all text-red-600"
                                            />
                                        </div>
                                        <div className="col-span-2 flex justify-center items-center">
                                            <button
                                                onClick={() => setActiveCameraRow(row.id)}
                                                className={`p-2 rounded-lg transition-all border ${row.image ? 'bg-green-50 border-green-200 text-green-600' : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100 hover:text-blue-500'}`}
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                            </button>

                                            {expenseRows.length > 1 && index !== expenseRows.length - 1 && (
                                                <button onClick={() => handleRemoveExpenseRow(row.id)} className="absolute -left-2 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M20 12H4" /></svg>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Dòng tổng cộng */}
                            {(() => {
                                const totalExpense = expenseRows.reduce((sum, row) => {
                                    return sum + (parseInt(String(row.amount).replace(/\D/g, '')) || 0);
                                }, 0);
                                return totalExpense > 0 ? (
                                    <div className="grid grid-cols-12 gap-2 items-center px-3 py-3 bg-red-50 border-t-2 border-red-200 rounded-b-xl">
                                        <div className="col-span-6 font-bold text-red-700 text-sm uppercase tracking-wide">Tổng cộng</div>
                                        <div className="col-span-4 text-right font-mono font-extrabold text-red-600 text-base">{totalExpense.toLocaleString()} đ</div>
                                        <div className="col-span-2"></div>
                                    </div>
                                ) : null;
                            })()}
                        </div>

                        {expenseMessage && (
                            <div className={`text-sm font-bold text-center py-2 rounded-xl ${expenseMessage.includes('thành công') ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                                {expenseMessage}
                            </div>
                        )}

                        <button
                            onClick={submitExpenses}
                            disabled={isSavingExpense}
                            className={`w-full py-4 rounded-xl text-white font-bold text-lg shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 mt-4
                                ${isSavingExpense ? 'bg-gray-400' : 'bg-red-500 hover:bg-red-600'}`}
                        >
                            {isSavingExpense ? (
                                <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Đang xử lý...</>
                            ) : (
                                <><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg> Lưu tổng chi</>
                            )}
                        </button>
                    </div>
                )}

                {activeTab === 'SUMMARY' && (
                    <div className="p-4 space-y-5">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-500"></div>
                            <h2 className="text-gray-500 text-sm font-bold uppercase tracking-widest mb-4 flex justify-between items-center">
                                Cân đối dòng tiền hôm nay
                                <span className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded normal-case font-medium">{todayStrDisplay}</span>
                            </h2>

                            <div className="space-y-4 text-base font-medium">
                                <div className="flex justify-between items-center pb-3 border-b border-gray-50">
                                    <span className="text-gray-600">Tồn quỹ ngày hôm trước (+)</span>
                                    <span className="font-mono font-bold text-gray-800">{summaryData.previousBalance.toLocaleString()}đ</span>
                                </div>
                                <div className="flex justify-between items-center pb-3 border-b border-gray-50">
                                    <span className="text-gray-600 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-500"></div> Tổng Thu chốt ca hôm nay</span>
                                    <span className="font-mono font-bold text-green-600">+{summaryData.todayThu.toLocaleString()}đ</span>
                                </div>
                                <div className="flex justify-between items-center pb-3 border-b border-gray-50">
                                    <span className="text-gray-600 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-red-500"></div> Tổng Chi hôm nay</span>
                                    <span className="font-mono font-bold text-red-500">-{summaryData.todayChi.toLocaleString()}đ</span>
                                </div>

                                <div className="pt-2">
                                    <div className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">Tồn quỹ hiện tại (Tiền mặt thực tế)</div>
                                    <div className="text-4xl font-extrabold text-blue-600">{summaryData.currentBalance.toLocaleString()}<span className="text-xl font-normal ml-1">đ</span></div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                            <h3 className="font-bold text-gray-800 mb-3 text-sm">Khoản chi hôm nay ({safeExpensesList.filter(e => isToday(e.timestamp)).length})</h3>
                            <div className="space-y-2 max-h-60 overflow-y-auto">
                                {safeExpensesList.filter(e => isToday(e.timestamp)).length === 0 ? (
                                    <p className="text-center text-xs text-gray-400 py-4">Chưa có khoản chi nào</p>
                                ) : (
                                    safeExpensesList.filter(e => isToday(e.timestamp)).map(exp => (
                                        <div key={exp.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-100">
                                            <div className="flex flex-col">
                                                <span className="font-bold text-gray-700 text-sm">{exp.note}</span>
                                                <span className="text-[10px] text-gray-400">{String(exp.timestamp)} - Bởi: {exp.createdBy}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="font-bold text-red-500 text-sm font-mono">-{Number(exp.amount).toLocaleString()}đ</span>
                                                {exp.image && (
                                                    <button onClick={() => { setPreviewImages([exp.image]); setCurrentPreviewIndex(0); }} className="text-blue-500 bg-blue-50 p-1.5 rounded-md hover:bg-blue-100">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {summaryMessage && (
                            <div className={`p-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 
                                ${summaryMessage.type === 'success' ? 'bg-green-50 text-green-600 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                                {summaryMessage.type === 'success' ? '✓' : '⚠'} {summaryMessage.text}
                            </div>
                        )}

                        <button 
                            onClick={handleSaveSummary}
                            disabled={isSavingSummary || isAlreadySavedSummary}
                            className={`w-full py-4 mt-4 rounded-xl text-white font-bold text-lg shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2
                                ${isSavingSummary || isAlreadySavedSummary ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                        >
                            {isSavingSummary ? (
                                <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Đang xử lý...</>
                            ) : isAlreadySavedSummary ? (
                                <><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> Đã chốt sổ hôm nay</>
                            ) : (
                                <><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg> Lưu dữ liệu Chốt Sổ</>
                            )}
                        </button>
                    </div>
                )}
            </div>

            {selectedOrder && (
                <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-center pointer-events-none">
                    <div className="fixed inset-0 bg-black/50 pointer-events-auto transition-opacity" onClick={() => setSelectedOrder(null)}></div>
                    <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto pointer-events-auto animate-slide-up sm:animate-none">
                        <div className="sticky top-0 bg-white border-b border-gray-100 p-4 flex items-center justify-between z-10 rounded-t-2xl">
                            <div className="flex flex-col"><h2 className="text-xl font-bold text-gray-800">Chi tiết đơn hàng</h2><span className="text-xs text-gray-400 font-mono">{selectedOrder.id}</span></div>
                            <button onClick={() => setSelectedOrder(null)} className="bg-gray-100 p-2 rounded-full hover:bg-gray-200"><svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
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
                                    <div className="text-right"><label className="text-xs font-bold text-gray-400 uppercase">Số lượng</label><div className="text-gray-800">{selectedOrder.items?.length || 0} món</div></div>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-gray-400 uppercase mb-2 block">Hình ảnh xác thực (POD)</label>
                                {selectedOrder.proofOfDelivery && selectedOrder.proofOfDelivery.imageUrl ? (
                                    <div className="group relative rounded-xl overflow-hidden border border-gray-200 shadow-sm bg-gray-900">
                                        <img src={getDirectDriveUrl(selectedOrder.proofOfDelivery.imageUrl)} alt="Proof of Delivery" className="w-full h-auto max-h-[600px] object-contain mx-auto" />
                                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 pt-12 text-white">
                                            <div className="text-xs font-medium space-y-1">
                                                <div className="flex items-center gap-1.5 text-gray-200">
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                    {new Date(selectedOrder.proofOfDelivery.timestamp || Date.now()).toLocaleString('vi-VN')}
                                                </div>
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

            {previewImages.length > 0 && (
                <div 
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fade-in" 
                    onClick={() => setPreviewImages([])}
                >
                    <div className="relative w-full max-w-2xl h-full flex flex-col items-center justify-center gap-4">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setPreviewImages([]); }} 
                            className="absolute z-10 top-4 left-4 text-white/70 bg-black/50 p-2 rounded-full hover:bg-black/80 hover:text-white transition-colors border border-white/10 shadow-lg"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>

                        <div className="relative flex-1 w-full flex items-center justify-center">
                            {previewImages.length > 1 && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setCurrentPreviewIndex(prev => prev > 0 ? prev - 1 : previewImages.length - 1); }}
                                    className="absolute left-2 z-10 bg-black/50 text-white p-3 rounded-full hover:bg-blue-600 transition-colors border border-white/20 shadow-lg backdrop-blur-md"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg>
                                </button>
                            )}

                            <img 
                                src={getDirectDriveUrl(previewImages[currentPreviewIndex])} 
                                alt={`Preview ${currentPreviewIndex + 1}`} 
                                className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl ring-1 ring-white/10" 
                                onClick={(e) => e.stopPropagation()} 
                            />

                            {previewImages.length > 1 && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setCurrentPreviewIndex(prev => prev < previewImages.length - 1 ? prev + 1 : 0); }}
                                    className="absolute right-2 z-10 bg-black/50 text-white p-3 rounded-full hover:bg-blue-600 transition-colors border border-white/20 shadow-lg backdrop-blur-md"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                                </button>
                            )}
                        </div>

                        {previewImages.length > 1 && (
                            <div className="flex justify-center gap-2 pb-8" onClick={(e) => e.stopPropagation()}>
                                {previewImages.map((_, idx) => (
                                    <button 
                                        key={idx}
                                        onClick={() => setCurrentPreviewIndex(idx)}
                                        className={`w-2.5 h-2.5 rounded-full transition-all ${idx === currentPreviewIndex ? 'bg-blue-500 scale-125' : 'bg-white/40 hover:bg-white/70'}`}
                                    />
                                ))}
                            </div>
                        )}
                        
                        {previewImages.length > 1 && (
                            <div className="absolute bottom-8 right-8 text-white/50 font-mono text-sm font-bold tracking-widest bg-black/40 px-3 py-1 rounded-full backdrop-blur">
                                {currentPreviewIndex + 1} / {previewImages.length}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AccountantDashboard;