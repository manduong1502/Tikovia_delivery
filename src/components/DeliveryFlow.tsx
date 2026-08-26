import React, { useState, useEffect, useRef } from 'react';
import { Order, OrderStatus, GeoLocation, PaymentMethod, ProofOfDelivery } from '../types';
import { calculateDistance, getCurrentLocation } from '../services/geoService';
import { sendDriverLocation, removeDriverLocation } from '../services/trackingService';
import { updateOrder } from '../services/mockDb';
import CameraCapture from './CameraCapture';
import MapTracker from './MapTracker';


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
        } catch (e) { return url; }
    }
    return url;
};

interface DeliveryFlowProps {
    order: Order;
    onOrderUpdate: (order: Order) => void;
    onBack: () => void;
    onDelete: (orderId: string) => void;
}

const CHECKIN_RADIUS_METERS = 50;

const statusLabels: Record<OrderStatus, string> = {
    [OrderStatus.ASSIGNED]: 'Đã gán',
    [OrderStatus.DELIVERING]: 'Đang giao',
    [OrderStatus.ARRIVED]: 'Đã đến',
    [OrderStatus.DELIVERED]: 'Hoàn tất',
    [OrderStatus.CANCELED]: 'Đã hủy'
};

const paymentMethodLabels: Record<PaymentMethod, string> = {
    [PaymentMethod.CASH]: 'Tiền mặt',
    [PaymentMethod.TRANSFER]: 'Chuyển khoản',
    [PaymentMethod.QR]: 'Mã QR'
};

const DeliveryFlow: React.FC<DeliveryFlowProps> = ({ order, onOrderUpdate, onBack, onDelete }) => {
    const [currentLocation, setCurrentLocation] = useState<GeoLocation | null>(null);
    const [distanceToTarget, setDistanceToTarget] = useState<number | null>(null);
    const [roadDistance, setRoadDistance] = useState<number | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [showCamera, setShowCamera] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [aiAnalysis, setAiAnalysis] = useState<string>('');
    const [hasLocationPermission, setHasLocationPermission] = useState<boolean | null>(null);

    // Wake Lock & Audio Refs
    const wakeLockRef = useRef<any>(null);

    // COD State
    const [collectedAmount, setCollectedAmount] = useState<string>((order.orderValue || 0).toString());
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CASH);

    const compressImage = (base64Str: string): Promise<string> => {
        return new Promise((resolve) => {
            const img = new Image();
            img.src = base64Str;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 350; // Độ phân giải tối ưu cực nhẹ (tốc độ nhanh)
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
                resolve(canvas.toDataURL('image/jpeg', 0.6)); // Nén 60% chất lượng
            };
        });
    };

    // --- LOGIC 1: GIỮ MÀN HÌNH LUÔN SÁNG (WAKE LOCK) ---
    useEffect(() => {
        const requestWakeLock = async () => {
            if ('wakeLock' in navigator && order.status === OrderStatus.DELIVERING) {
                try {
                    wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
                    console.log('Screen Wake Lock active - GPS will keep running');

                    wakeLockRef.current.addEventListener('release', () => {
                        console.log('Wake Lock released');
                    });
                } catch (err: any) {
                    console.error(`${err.name}, ${err.message}`);
                }
            }
        };

        const releaseWakeLock = async () => {
            if (wakeLockRef.current) {
                try {
                    await wakeLockRef.current.release();
                    wakeLockRef.current = null;
                } catch (e) {
                    console.error('Error releasing wake lock', e);
                }
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && order.status === OrderStatus.DELIVERING) {
                requestWakeLock();
            }
        };

        if (order.status === OrderStatus.DELIVERING) {
            requestWakeLock();
            document.addEventListener('visibilitychange', handleVisibilityChange);
        } else {
            releaseWakeLock();
        }

        return () => {
            releaseWakeLock();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [order.status]);


    // --- LOGIC 2: SIMULATION OF REALTIME TRACKING ---
    useEffect(() => {
        let watchId: number;

        const handlePositionUpdate = (lat: number, lng: number, accuracy: number) => {
            const newLoc = {
                lat,
                lng,
                timestamp: Date.now(),
                accuracy,
            };
            setCurrentLocation(newLoc);
            setHasLocationPermission(true);

            if (order.status === OrderStatus.DELIVERING) {
                sendDriverLocation(order.driverId || 'unknown', {
                    name: order.driverName || 'Tài xế',
                    lat: lat,
                    lng: lng,
                    orderId: order.id
                });
            }

            // Kiểm tra nếu order.location undefined trước khi tính distance
            if (!order.location || !order.location.lat || !order.location.lng) {
                // setErrorMsg("Đơn hàng thiếu thông tin vị trí. Vui lòng cập nhật.");
                return;
            }

            // Calculate straight line distance for Check-in logic (always needed)
            const dist = calculateDistance(
                newLoc.lat,
                newLoc.lng,
                order.location.lat,
                order.location.lng
            );
            setDistanceToTarget(dist);
        };

        const initLocationTracking = async () => {
            // Không yêu cầu tự động lấy vị trí nếu đơn hàng chưa bắt đầu giao.
            if (order.status !== OrderStatus.DELIVERING) {
                setHasLocationPermission(true);
                return;
            }

            try {
                // Tối ưu cho iOS: Tránh gọi getCurrentLocation liên tiếp gây treo Zalo SDK / WKWebView.
                // Nếu currentLocation đã có (từ lúc nhấn Bắt đầu giao), bỏ qua việc gọi lại.
                if (!currentLocation) {
                    const loc = await getCurrentLocation();
                    handlePositionUpdate(loc.lat, loc.lng, loc.accuracy || 10);
                }
                
                if (navigator.geolocation && order.status === OrderStatus.DELIVERING) {
                    watchId = navigator.geolocation.watchPosition(
                        (position) => handlePositionUpdate(position.coords.latitude, position.coords.longitude, position.coords.accuracy),
                        (err) => {
                            console.error("Watch position error:", err);
                            // Cảnh báo nếu đang giao hàng mà mất GPS
                            setErrorMsg("Mất kết nối GPS, đang thử kết nối lại...");
                        },
                        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
                    );
                }
            } catch (error: any) {
                console.warn('Location Init failed', error);
                setHasLocationPermission(false);
            }
        };

        // Kích hoạt check quyền & tracking
        initLocationTracking();

        return () => {
            if (watchId) navigator.geolocation.clearWatch(watchId);
        };
    }, [order.status, order.location, order.driverId, order.driverName, order.id]);

    const handleClaimOrder = async () => {
        try {
            setIsProcessing(true);
            const currentUser = getCurrentUser();
            const updatedOrder: Order = {
                ...order,
                driverId: currentUser?.id || 'driver-1',
                driverName: currentUser?.fullName || 'Tài xế',
                status: OrderStatus.ASSIGNED
            };
            onOrderUpdate(updatedOrder);
            await updateOrder(updatedOrder);
        } catch (error) {
            console.error("Lỗi khi nhận đơn:", error);
            alert("Không thể nhận đơn hàng này. Vui lòng thử lại!");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleStartDelivery = async () => {
        try {
            setIsProcessing(true);
            
            // Lấy vị trí bằng getCurrentLocation (vẫn bắt buộc để test permission)
            const loc = await getCurrentLocation(); 
            
            // Nếu qua được bước trên nghĩa là đã cấp quyền thành công
            setHasLocationPermission(true);
            
            // Lập tức set currentLocation để giao diện Map hiện ra và tránh useEffect gọi GPS lần 2 gây treo iOS
            setCurrentLocation({
                lat: loc.lat,
                lng: loc.lng,
                timestamp: Date.now(),
                accuracy: loc.accuracy || 10
            });

            const updatedOrder = {
                ...order,
                status: OrderStatus.DELIVERING,
                driverLocation: loc
            };
            
            // Lập tức phản hồi giao diện không bắt chờ server đồng bộ
            onOrderUpdate(updatedOrder);

            // Đồng bộ ngầm chạy sau
            updateOrder(updatedOrder).catch(console.error);

        } catch (e: any) {
            console.error("Lỗi cấp quyền vị trí khi bắt đầu giao:", e);
            setHasLocationPermission(false);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCheckIn = async () => {
        setIsProcessing(true);
        setErrorMsg(null);
        try {
            // Tối ưu tốc độ: dùng luôn vị trí GPS có sẵn trong bộ nhớ nếu có thể, tránh bắt thiết bị định vị lại
            const loc = currentLocation || await getCurrentLocation().catch(() => ({ lat: 0, lng: 0, timestamp: Date.now() }));

            // Kiểm tra location
            if (!order.location || !order.location.lat || !order.location.lng) {
                setErrorMsg("Đơn hàng thiếu thông tin vị trí. Vui lòng cập nhật.");
                return;
            }

            const dist = calculateDistance(loc.lat, loc.lng, order.location.lat, order.location.lng);
            console.log(`Check-in at distance: ${dist}m`);

            const updatedOrder = { ...order, status: OrderStatus.ARRIVED };
            
            // UI vẽ lại màu trạng thái LẬP TỨC
            onOrderUpdate(updatedOrder);

            // Ẩn việc gửi API chậm bằng cách chạy ngầm
            updateOrder(updatedOrder).catch(err => console.error("Lỗi đồng bộ đã đến:", err));

        } catch (err) {
            setErrorMsg("Lỗi hệ thống khi check-in.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handlePhotoCaptured = async (imageData: string, addressStr: string, cachedLocation: GeoLocation | null) => {
        setShowCamera(false);
        try {
            const loc = cachedLocation || (currentLocation ? {
                lat: currentLocation.lat,
                lng: currentLocation.lng,
                timestamp: Date.now()
            } : { lat: 0, lng: 0, timestamp: Date.now() });

            const proof: ProofOfDelivery = {
                imageUrl: imageData, // Giữ nguyên ảnh cục bộ
                timestamp: Date.now(),
                location: loc,
                address: addressStr
            };

            const updatedOrder = { ...order, proofOfDelivery: proof };
            
            // XÓA BỎ LỆNH 'await updateOrder' KHỎI ĐÂY ĐỂ TRÁNH LAG MÁY TÀI XẾ.
            // UI CẬP NHẬT TỨC THÌ, CHỜ TÀI XẾ NHẤN NÚT "HOÀN TẤT" MỚI TIẾN HÀNH UPLOAD 1 LẦN!
            onOrderUpdate(updatedOrder);
        } catch (e) {
            setErrorMsg("Lỗi quá trình xử lý ảnh.");
        }
    };

    const handleSubmitCOD = async () => {
        if (!order.proofOfDelivery) {
            setErrorMsg("Vui lòng chụp ảnh xác thực trước.");
            return;
        }

        const collected = parseInt(collectedAmount.replace(/\D/g, ''));
        if (isNaN(collected)) {
            setErrorMsg("Số tiền không hợp lệ.");
            return;
        }

        if (order.driverId) removeDriverLocation(order.driverId);

        // Tính toán dựa trên THỜI GIAN CHỤP ẢNH
        const deliveryTime = new Date(order.proofOfDelivery?.timestamp || Date.now());
        const formattedTime = deliveryTime.toLocaleString('vi-VN', {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            day: '2-digit', month: '2-digit', year: 'numeric'
        });

        const currentHour = deliveryTime.getHours();
        const currentMinute = deliveryTime.getMinutes();
        const totalMinutes = currentHour * 60 + currentMinute;
        
        // Ca sáng: kết thúc 12h00
        const SHIFT1_END = 12 * 60;
        // Ca chiều: kết thúc 18h00
        const SHIFT2_END = 18 * 60;

        let overtimeMinutes = 0;
        if (totalMinutes > SHIFT2_END) { // Sau 18h
            overtimeMinutes = totalMinutes - SHIFT2_END;
        } else if (totalMinutes > SHIFT1_END && totalMinutes < 14 * 60) { // Giữa 12h và 14h (sau ca sáng)
            overtimeMinutes = totalMinutes - SHIFT1_END;
        }

        const overtimeStr = overtimeMinutes > 0 ? `${overtimeMinutes} phút` : '';

        const updatedOrder: Order = {
            ...order,
            status: OrderStatus.DELIVERED,
            codTransaction: {
                amount: collected,
                method: paymentMethod,
                collectedAt: Date.now(),
                discrepancy: collected - (order.orderValue || 0)
            },
            completedAtFormatted: formattedTime,
            overtimeString: overtimeStr
        };

        setIsProcessing(true);
        try {
            const savedOrder = await updateOrder(updatedOrder);
            onOrderUpdate(savedOrder);
        } catch (e) {
            setErrorMsg("Lỗi quá trình gửi dữ liệu hệ thống.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDelete = () => {
        if (window.confirm('Bạn có chắc chắn muốn xóa đơn hàng này? Hành động này không thể hoàn tác.')) {
            setIsDeleting(true);
            onDelete(order.id);
        }
    };

    const openGoogleMaps = async () => {
        // Kiểm tra location trước
        if (!order.location || !order.location.lat || !order.location.lng) {
            setErrorMsg("Đơn hàng thiếu vị trí để mở bản đồ.");
            return;
        }

        let currentLat = 0, currentLng = 0;

        if (currentLocation) {
            currentLat = currentLocation.lat;
            currentLng = currentLocation.lng;
        } else {
            try {
                const loc = await getCurrentLocation();
                currentLat = loc.lat;
                currentLng = loc.lng;
            } catch (e) {
                console.warn("Không lấy được vị trí hiện tại, sẽ để Google Maps tự định vị");
            }
        }

        let mapUrl = `https://www.google.com/maps/dir/?api=1&destination=${order.location.lat},${order.location.lng}&travelmode=driving`;

        if (currentLat && currentLng) {
            mapUrl += `&origin=${currentLat},${currentLng}`;
        }

        console.log('Mở URL:', mapUrl);

        window.open(mapUrl, '_blank');
    };

    const handleShareLocation = async () => {
        if (!currentLocation) {
            alert("Chưa có vị trí GPS.");
            return;
        }

        const mapsLink = `https://www.google.com/maps/search/?api=1&query=${currentLocation.lat},${currentLocation.lng}`;
        const message = `[SmartLogistics] Tài xế đang giao đơn ${order.id}. Vị trí lúc ${new Date().toLocaleTimeString()}: ${mapsLink}`;


        if (navigator.share) {
            try {
                await navigator.share({
                    title: `Vị trí giao hàng ${order.id}`,
                    text: message,
                    url: mapsLink
                });
                return;
            } catch (error) {
                console.log('Error sharing:', error);
            }
        }

        try {
            await navigator.clipboard.writeText(message);
            alert('Đã sao chép liên kết vị trí vào bộ nhớ tạm!');
        } catch (e) {
            alert('Không thể sao chép. Vui lòng thử lại.');
        }
    };

    if (showCamera) {
        return <CameraCapture onCapture={handlePhotoCaptured} onCancel={() => setShowCamera(false)} />;
    }

    if (hasLocationPermission === null) {
        return (
            <div className="flex flex-col h-full bg-gray-50 items-center justify-center">
                <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-gray-500 font-medium">Đang kiểm tra quyền định vị...</p>
            </div>
        );
    }

    if (hasLocationPermission === false) {
        return (
            <div className="flex flex-col h-full bg-white relative">
                 <div className="bg-white pt-9 p-4 shadow-sm flex items-center justify-between sticky top-0 z-10 border-b border-gray-100 flex-none">
                    <button onClick={onBack} className="text-gray-500 font-medium px-4 py-2 bg-gray-100 rounded-full">Đóng</button>
                    <h1 className="font-bold text-gray-800">{order.id}</h1>
                    <div className="w-8"></div>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mb-6">
                        <svg className="w-12 h-12 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Truy cập vị trí bị từ chối</h2>
                    <p className="text-gray-500 mb-8">
                        Để tiếp tục quá trình giao hàng, ứng dụng cần quyền truy cập vị trí (GPS) để chỉ đường và tự động xác nhận quãng đường. Vui lòng cấp quyền trong cài đặt thiết bị/trình duyệt của bạn.
                    </p>
                    <div className="space-y-3 w-full max-w-xs">
                        <button
                            onClick={() => {
                                // Resetting to null will trigger the component to re-render the loading state
                                // and we need to explicitly call initLocationTracking, BUT since it's in a useEffect
                                // dependent on order.status etc, it might not re-run just by setting state to null.
                                // The easiest way to force a re-check is to call getCurrentLocation directly here.
                                setHasLocationPermission(null);
                                getCurrentLocation().then(loc => {
                                    setCurrentLocation({
                                        lat: loc.lat,
                                        lng: loc.lng,
                                        timestamp: Date.now(),
                                        accuracy: loc.accuracy || 10
                                    });
                                    setHasLocationPermission(true);
                                }).catch(() => {
                                    setHasLocationPermission(false);
                                });
                            }}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                        >
                            <svg className="w-5 h-5 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            Kiểm tra lại quyền
                        </button>
                        <button
                            onClick={onBack}
                            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3.5 rounded-xl transition-all active:scale-95"
                        >
                            Quay lại danh sách
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-gray-50">
            {/* Header */}
            <div className="bg-white pt-9 p-4 shadow-sm flex items-center justify-between sticky top-0 z-10">
                <button onClick={onBack} className="px-4 py-2 bg-blue-600 text-white font-medium rounded-full">Quay lại</button>
                <div className="flex items-center gap-2 pr-[75px]">
                    <h1 className="font-bold text-gray-800">{order.id}</h1>
                    <button
                        onClick={handleDelete}
                        disabled={isDeleting}
                        className="p-2 text-red-500 bg-red-50 rounded-full transition-colors disabled:opacity-50"
                        title="Xóa đơn hàng"
                    >
                        {isDeleting ? (
                            <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        )}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">

                <div className="flex items-center justify-between">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${order.status === OrderStatus.DELIVERED ? 'bg-green-100 text-green-700' :
                        order.status === OrderStatus.ARRIVED ? 'bg-purple-100 text-purple-700' :
                            'bg-blue-100 text-blue-700'
                        }`}>
                        {statusLabels[order.status]}
                    </span>
                    <span className="text-gray-400 text-xs">Created: {new Date().toLocaleDateString()}</span>
                </div>

                {/* Customer Info */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-gray-500 text-sm uppercase font-semibold mb-2">Khách hàng</h3>
                    <p className="text-lg font-bold text-gray-900">{order.customerName}</p>
                    {order.customerPhone && (
                        <p className="text-gray-800 font-medium mb-1">{order.customerPhone}</p>
                    )}
                    <p className="text-gray-600">{order.address}</p>
                    <button 
                        onClick={() => {
                            if (order.customerPhone) {
                                navigator.clipboard.writeText(order.customerPhone);
                                alert('Đã chép số điện thoại!');
                            } else {
                                alert('Không có số điện thoại để chép.');
                            }
                        }}
                        className="mt-4 w-full bg-blue-50 hover:bg-blue-100 py-2.5 rounded-lg text-blue-700 font-bold text-sm border border-blue-200 transition-colors flex items-center justify-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        Copy số điện thoại
                    </button>
                </div>

                {/* Driver Info */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-gray-500 text-sm uppercase font-semibold mb-2">Tài xế</h3>
                    <p className="text-lg font-bold text-gray-900">{order.driverName || 'Chưa gán'}</p>
                    <p className="text-gray-600">{order.driverId || 'ID: N/A'}</p>
                </div>

                {/* Items Info */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-gray-500 text-sm uppercase font-semibold mb-2">Sản phẩm (Số lượng: {order.items?.length || 0})</h3>
                    {order.items && order.items.length > 0 ? (
                        <ul className="list-disc pl-5">
                            {order.items.map((item, index) => (
                                <li key={index} className="text-gray-600">{item}</li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-gray-600">Chưa có thông tin sản phẩm.</p>
                    )}
                </div>

                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-gray-500 text-sm uppercase font-semibold mb-3">Chi tiết đơn hàng</h3>

                    {/* Giá trị đơn hàng */}
                    <div className="flex justify-between items-center mb-3">
                        <span className="text-gray-600 font-medium">Tổng tiền thu (COD)</span>
                        <span className="text-xl font-bold text-blue-600">
                            {(order.orderValue || 0).toLocaleString()} đ
                        </span>
                    </div>

                    {/* Ghi chú */}
                    <div className="pt-3 border-t border-gray-100">
                        <span className="text-gray-500 text-xs uppercase font-semibold mb-1 block">Ghi chú</span>
                        <div className={`p-3 rounded-lg text-sm border ${order.note ? 'bg-yellow-50 text-gray-800 border-yellow-200' : 'bg-gray-50 text-gray-400 italic border-gray-100'}`}>
                            {order.note ? (
                                <div className="flex gap-2">
                                    <svg className="w-5 h-5 text-yellow-600 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>
                                    <span>{order.note}</span>
                                </div>
                            ) : "Không có ghi chú"}
                        </div>
                    </div>
                </div>

                {/* Map Visualization */}
                {(order.status === OrderStatus.DELIVERING || order.status === OrderStatus.ASSIGNED) && (
                    <div className="space-y-2">
                        <h3 className="text-gray-500 text-sm uppercase font-semibold">Bản đồ di chuyển</h3>

                        {/* THÊM LOGIC KIỂM TRA currentLocation Ở ĐÂY */}
                        {currentLocation ? (
                            <MapTracker
                                currentLocation={currentLocation}
                                targetLocation={order.location}
                                checkInRadius={CHECKIN_RADIUS_METERS}
                                onDistanceChange={(meters) => setRoadDistance(meters)}
                            />
                        ) : order.status === OrderStatus.ASSIGNED ? (
                            <div className="h-48 bg-gray-50 rounded-xl flex items-center justify-center border border-gray-200 shadow-inner">
                                <div className="flex flex-col items-center gap-3 text-gray-500">
                                    <svg className="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                    <span className="text-sm font-medium">Bản đồ sẽ hiện vị trí GPS của bạn khi bắt đầu giao</span>
                                </div>
                            </div>
                        ) : (
                            <div className="h-48 bg-gray-50 rounded-xl flex items-center justify-center border border-gray-200 shadow-inner">
                                <div className="flex flex-col items-center gap-3 text-blue-500">
                                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                    <span className="text-sm font-medium animate-pulse">Đang định vị GPS...</span>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 mt-2">
                            <button
                                onClick={openGoogleMaps}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-1 shadow active:scale-95 transition-all"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                Chỉ đường
                            </button>
                            <button
                                onClick={handleShareLocation}
                                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-4 py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-1 shadow-sm active:scale-95 transition-all border border-indigo-200"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                                Gửi vị trí
                            </button>
                        </div>

                        <div className="flex items-center justify-between bg-blue-50 px-3 py-2 rounded-lg border border-blue-100 mt-2">
                            <span className="text-blue-800 font-medium text-xs uppercase">Khoảng cách dự kiến</span>
                            <span className="text-blue-900 font-bold">
                                {roadDistance !== null
                                    ? `${(roadDistance / 1000).toFixed(1)} km`
                                    : (distanceToTarget ? `${(distanceToTarget / 1000).toFixed(1)} km` : '...')}
                            </span>
                        </div>
                    </div>
                )}

                {/* Status Actions */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-4">
                    <h3 className="text-gray-500 text-sm uppercase font-semibold">Quy trình giao hàng</h3>

                    {!order.driverId || order.driverId === 'unknown' || order.driverId === 'Chưa gán' || order.driverId === '' || order.driverId === '0' ? (
                        <div className="space-y-2">
                            <button
                                onClick={handleClaimOrder}
                                disabled={isProcessing}
                                className={`w-full text-white font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2
                                    ${isProcessing ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
                            >
                                {isProcessing ? (
                                    <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Đang nhận đơn...</>
                                ) : (
                                    <><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg> Nhận đơn hàng</>
                                )}
                            </button>
                        </div>
                    ) : (
                        <>
                            {order.status === OrderStatus.ASSIGNED && (
                                <div className="space-y-2">
                                    <button
                                        onClick={handleStartDelivery}
                                        disabled={isProcessing}
                                        className={`w-full text-white font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2
                                            ${isProcessing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
                                    >
                                        {isProcessing ? (
                                            <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Đang kiểm tra định vị...</>
                                        ) : (
                                            <><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> Bắt đầu giao</>
                                        )}
                                    </button>
                                </div>
                            )}

                    {order.status === OrderStatus.DELIVERING && (
                        <div className="space-y-4">
                            {errorMsg && (
                                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2 border border-red-100">
                                    <svg className="w-5 h-5 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333 .192 3 1.732 3z" /></svg>
                                    {errorMsg}
                                </div>
                            )}

                            <button
                                onClick={handleCheckIn}
                                disabled={isProcessing}
                                className={`w-full font-bold py-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2
                            ${isProcessing ? 'bg-gray-300 text-gray-500' : 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-95'}
                        `}
                            >
                                {isProcessing ? 'Đang xác thực...' : 'Xác nhận Đã đến'}
                            </button>
                        </div>
                    )}

                    {(order.status === OrderStatus.ARRIVED || order.status === OrderStatus.DELIVERED) && (
                        <div className="space-y-4">
                            {order.proofOfDelivery ? (
                                <div className="relative rounded-lg overflow-hidden border border-gray-200">
                                    <img src={getDirectDriveUrl(order.proofOfDelivery.imageUrl)} alt="POD" className="w-full h-48 object-cover" />
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-2 text-white text-xs">
                                        {order.proofOfDelivery.address ? (
                                            <div className="font-semibold leading-snug">{order.proofOfDelivery.address}</div>
                                        ) : (
                                            <>
                                                <div>LAT: {order.proofOfDelivery.location?.lat?.toFixed(6)}</div>
                                                <div>LNG: {order.proofOfDelivery.location?.lng?.toFixed(6)}</div>
                                            </>
                                        )}
                                        <div className="mt-1 text-gray-300 text-[10px]">{new Date(order.proofOfDelivery.timestamp || Date.now()).toLocaleString('vi-VN')}</div>
                                        {aiAnalysis && <div className="text-green-300 font-bold mt-1">AI: {aiAnalysis}</div>}
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setShowCamera(true)}
                                    className="w-full bg-gray-900 hover:bg-black text-white font-bold py-4 rounded-xl shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-transform"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                    Chụp ảnh xác nhận
                                </button>
                            )}
                        </div>
                    )}

                    {order.status === OrderStatus.ARRIVED && order.proofOfDelivery && (
                        <div className="pt-4 border-t border-gray-100">
                            <h3 className="text-gray-900 font-bold mb-4">Thu tiền (COD)</h3>

                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Giá trị đơn</label>
                                <div className="text-xl font-bold text-gray-900">{(order.orderValue || 0).toLocaleString()} VND</div>
                            </div>

                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Số tiền thực thu</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={collectedAmount}
                                    onChange={(e) => {
                                        const raw = e.target.value.replace(/\D/g, '');
                                        setCollectedAmount(raw ? parseInt(raw, 10).toLocaleString('en-US') : '');
                                    }}
                                    className="w-full p-3 border border-gray-300 rounded-lg font-mono text-lg focus:ring-2 focus:ring-green-500 outline-none bg-white text-black font-bold"
                                />
                            </div>

                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-700 mb-2">Hình thức thanh toán</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {Object.values(PaymentMethod).map(method => (
                                        <button
                                            key={method}
                                            onClick={() => setPaymentMethod(method)}
                                            className={`py-2 px-1 rounded-lg text-sm font-medium border ${paymentMethod === method
                                                ? 'bg-green-50 border-green-500 text-green-700'
                                                : 'bg-white border-gray-200 text-gray-600'
                                                }`}
                                        >
                                            {paymentMethodLabels[method]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {errorMsg && <p className="text-red-500 text-sm mb-4">{errorMsg}</p>}

                            <button
                                onClick={handleSubmitCOD}
                                disabled={isProcessing}
                                className={`w-full text-white font-bold py-4 rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all
                                    ${isProcessing ? 'bg-gray-400 cursor-not-allowed text-gray-200 shadow-none' : 'bg-green-600 hover:bg-green-700 active:scale-95'}`}
                            >   
                                {isProcessing ? (
                                    <><div className="w-5 h-5 border-2 border-white/50 border-t-white rounded-full animate-spin"></div> <span>Đang tải lên máy chủ...</span></>
                                ) : (
                                    'Xác nhận & Hoàn tất'
                                )}
                            </button>
                        </div>
                    )}

                    {order.status === OrderStatus.DELIVERED && (
                        <div className="bg-green-50 p-4 rounded-lg text-center border border-green-100">
                            <div className="inline-flex items-center justify-center w-12 h-12 bg-green-100 rounded-full mb-2">
                                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            </div>
                            <h3 className="text-green-800 font-bold">Giao hàng thành công</h3>
                            <p className="text-green-600 text-sm">Đã ghi nhận giao dịch.</p>
                        </div>
                    )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DeliveryFlow;