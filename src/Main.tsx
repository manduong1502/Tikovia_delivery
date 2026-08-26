import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getOrders, hydrateOrdersWithLocation, createOrder, deleteOrder } from './services/mockDb';
import { getCurrentLocation } from './services/geoService';
import { getCurrentUser, logout } from './services/authService';
import { Order, OrderStatus, User, UserRole } from './types';
import { isGoogleMode, isServerMode } from '../config';
import DeliveryFlow from './components/DeliveryFlow';
import CODReport from './components/CODReport';
import CreateOrderForm from './components/CreateOrderForm';
import LoginScreen from './components/LoginScreen';

const ManagerDashboard = React.lazy(() => import('./components/ManagerDashboard'));
const AccountantDashboard = React.lazy(() => import('./components/AccountantDashboard'));

type View = 'LIST' | 'DELIVERY' | 'WALLET' | 'CREATE' | 'MANAGER';

const statusLabels: Record<OrderStatus, string> = {
  [OrderStatus.ASSIGNED]: 'Đã gán',
  [OrderStatus.DELIVERING]: 'Đang giao',
  [OrderStatus.ARRIVED]: 'Đã đến',
  [OrderStatus.DELIVERED]: 'Hoàn tất',
  [OrderStatus.CANCELED]: 'Đã hủy'
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
              
              // Kiểm tra format: "HH:mm:ss DD/MM/YYYY" (time trước date)
              // parts: ["09","01","25","23","03","2026"]
              // → parts[5] là năm (> 2000)
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
                  // Không rõ format → thử new Date()
                  dateObj = new Date(dateString);
                  day = dateObj.getDate();
                  month = dateObj.getMonth();
                  year = dateObj.getFullYear();
              }
              
              if (!dateObj || isNaN(dateObj.getTime())) {
                  dateObj = new Date(year, month, day);
              }
          } else if (parts.length >= 3) {
              // Format ngắn: DD/MM/YYYY hoặc M/D/YYYY (không có giờ)
              const p0 = parseInt(parts[0], 10);
              const p1 = parseInt(parts[1], 10);
              const p2 = parseInt(parts[2], 10);
              
              let day: number, month: number, year: number;
              if (p2 > 2000) {
                  year = p2;
                  // Mặc định DD/MM/YYYY (format VN)
                  day = p0;
                  month = p1 - 1;
              } else {
                  dateObj = new Date(dateString);
                  day = dateObj.getDate();
                  month = dateObj.getMonth();
                  year = dateObj.getFullYear();
              }
              
              if (!dateObj || isNaN(dateObj.getTime())) {
                  dateObj = new Date(year, month, day);
              }
          } else {
              dateObj = new Date(dateString);
          }
      } else {
          // ISO format hoặc format khác
          dateObj = new Date(order.createdAt);
      }
  }

  // Fallback: parse từ order ID nếu có timestamp
  if ((!dateObj || isNaN(dateObj.getTime())) && order.id && order.id.startsWith('DH-')) {
      const idPart = order.id.split('-')[1];
      if (idPart && idPart.length >= 12) {
          const timestamp = parseInt(idPart, 10);
          if (!isNaN(timestamp)) {
              dateObj = new Date(timestamp);
          }
      }
  }

  // Nếu không parse được ngày → mặc định hiện đơn
  if (!dateObj || isNaN(dateObj.getTime())) {
      return true;
  }

  const today = new Date();
  return dateObj.getDate() === today.getDate() &&
      dateObj.getMonth() === today.getMonth() &&
      dateObj.getFullYear() === today.getFullYear();
};

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>('LIST');
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<{ lat: number, lng: number } | undefined>(undefined);
  const [locallyDeletedIds, setLocallyDeletedIds] = useState<Set<string>>(new Set());

  // --- STATE CHO PHÂN TRANG ---
  const [currentPage, setCurrentPage] = useState(1);
  const [driverSubTab, setDriverSubTab] = useState<'MY_TASKS' | 'AVAILABLE'>('AVAILABLE');
  const ORDERS_PER_PAGE = 20;

  // Ref for Wake Lock instance
  const wakeLockRef = useRef<any>(null);
  const isTabActive = useRef(true);

  // --- BACKGROUND & SLEEP PREVENTION LOGIC (Web Wake Lock API) ---
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        console.log("Đã giữ sáng màn hình (Wake Lock)");
      }
    } catch (e) {
      console.warn("Wake Lock không khả dụng:", e);
    }
  };

  const releaseWakeLock = async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch (e) {
      console.warn("Lỗi release Wake Lock:", e);
    }
  };

  useEffect(() => {
    const handleVisibilityChange = () => {
      isTabActive.current = document.visibilityState === 'visible';
      if (isTabActive.current && user && (view === 'DELIVERY' || view === 'LIST')) {
        requestWakeLock();
        refreshData(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [user, view]);

  useEffect(() => {
    if (user?.role === UserRole.DRIVER && (view === 'DELIVERY' || view === 'LIST')) {
      requestWakeLock();
    } else {
      releaseWakeLock(); 
    }
    return () => { releaseWakeLock(); };
  }, [view, user]);

  useEffect(() => {
    const currentUser = getCurrentUser();
    if (currentUser) {
      setUser(currentUser);
    } else {
      setIsLoading(false);
    }
  }, []);

  const refreshData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      let finalOrders: Order[] = [];
      if (isGoogleMode() || isServerMode()) {
        finalOrders = await getOrders();
      }
      setOrders(finalOrders);
    } catch (e) {
      console.error("Data refresh failed", e);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      refreshData();
    }
  }, [user, refreshData]);

  useEffect(() => {
    if (user && user.role === UserRole.DRIVER && view !== 'CREATE') {
      const interval = setInterval(() => {
        refreshData(true);
      }, 20000);
      return () => clearInterval(interval);
    } else {
      return undefined;
    }
  }, [user, view, refreshData]);

  const filteredOrders = useMemo(() => {
    return orders.filter(o => !locallyDeletedIds.has(o.id));
  }, [orders, locallyDeletedIds]);

  const handleLoginSuccess = (loggedInUser: User) => {
    setUser(loggedInUser);
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setView('LIST');
    setOrders([]);
    setLocallyDeletedIds(new Set());
    setCurrentPage(1); // Reset trang khi đăng xuất
    releaseWakeLock();
  };

  const handleOrderUpdate = (updatedOrder: Order) => {
    setOrders(prev => prev.map(o => o.id === updatedOrder.id ? updatedOrder : o));
    if (activeOrder?.id === updatedOrder.id) {
      setActiveOrder(updatedOrder);
    }
  };

  const handleCreateOrder = async (data: { customerName: string; address: string; orderValue: number; itemsString: string; location?: { lat: number; lng: number }; routeId?: string; }) => {
    const driverInfo = (user && user.role === UserRole.DRIVER)
      ? { id: user.id, fullName: user.fullName }
      : undefined;

    const newOrder = await createOrder(data, userLocation, driverInfo);
    setOrders(prev => {
      // Tránh trùng lặp do race condition với background fetch
      if (prev.some(o => o.id === newOrder.id)) {
          return prev.map(o => o.id === newOrder.id ? newOrder : o);
      }
      return [...prev, newOrder]; // Appends to the end, since .reverse() is used later
    });
    setCurrentPage(1); // Trở về trang 1 để xem đơn vừa tạo
  };

  const handleSelectOrder = (order: Order) => {
    setActiveOrder(order);
    setView('DELIVERY');
  };

  const handleDeleteOrder = async (orderId: string) => {
    setLocallyDeletedIds(prev => {
      const next = new Set(prev);
      next.add(orderId);
      return next;
    });
    if (activeOrder?.id === orderId) {
      setActiveOrder(null);
      setView('LIST');
    }
    try {
      await deleteOrder(orderId);
    } catch (error) {
      console.error("Delete failed on server", error);
      alert("Có lỗi xảy ra khi xóa trên máy chủ. Đơn hàng có thể xuất hiện lại sau khi tải lại trang.");
    }
  };

  if (!user) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  if (user.role === UserRole.ACCOUNTANT) {
    return (
      <React.Suspense fallback={<div className="flex items-center justify-center h-full bg-gray-50"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div></div>}>
        <AccountantDashboard orders={filteredOrders} onBack={handleLogout} />
      </React.Suspense>
    );
  }

  if (user.role === UserRole.MANAGER) {
    return (
      <React.Suspense fallback={<div className="flex items-center justify-center h-full bg-gray-50"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div></div>}>
        <ManagerDashboard orders={filteredOrders} onBack={handleLogout} />
      </React.Suspense>
    );
  }

  // Lọc danh sách đơn hôm nay
  const myOrders = [...filteredOrders].filter(o => o.driverId === user.id && isToday(o)).reverse();
  const availableOrders = [...filteredOrders].filter(o => (!o.driverId || o.driverId === '' || o.driverId === user.id) && isToday(o)).reverse();
  
  const activeOrdersList = driverSubTab === 'MY_TASKS' ? myOrders : availableOrders;

  // TÍNH TOÁN PHÂN TRANG
  const totalPages = Math.ceil(activeOrdersList.length / ORDERS_PER_PAGE);
  const startIndex = (currentPage - 1) * ORDERS_PER_PAGE;
  // Lấy ra danh sách 20 đơn hàng cho trang hiện tại
  const currentOrders = activeOrdersList.slice(startIndex, startIndex + ORDERS_PER_PAGE);

  const renderDriverContent = () => {
    if (view === 'CREATE') {
      return (
        <CreateOrderForm
          onSubmit={handleCreateOrder}
          onCancel={() => setView('LIST')}
          currentUser={user}
        />
      );
    }

    if (view === 'DELIVERY' && activeOrder) {
      return (
        <DeliveryFlow
          order={activeOrder}
          onOrderUpdate={handleOrderUpdate}
          onDelete={handleDeleteOrder}
          onBack={() => {
            setActiveOrder(null);
            setView('LIST');
          }}
        />
      );
    }

    return (
      <>
        {/* Header */}
        <div className="bg-white pt-9 p-4 shadow-sm z-10 flex-none border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-blue-600">SmartLogistics</h1>
              <div className="text-xs text-gray-500 font-medium">Xin chào, {user.fullName}</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setView('CREATE')}
                className="text-xs font-bold bg-blue-600 text-white px-3 py-2 rounded-full hover:bg-blue-700 shadow-md transition-all active:scale-95 flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
                Tạo đơn
              </button>
              <button
                onClick={handleLogout}
                className="p-2 bg-gray-50 text-red-500 rounded-full hover:bg-red-50 hover:text-red-500 transition-colors border border-gray-200"
                title="Đăng xuất"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </button>
            </div>
          </div>
        </div>

        {/* Driver 2-Tab Segmented Control Bar */}
        {view === 'LIST' && (
          <div className="px-4 py-2 bg-white border-b border-gray-100 flex gap-2 flex-none shadow-sm">
            <button
              onClick={() => { setDriverSubTab('MY_TASKS'); setCurrentPage(1); }}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                driverSubTab === 'MY_TASKS' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              Nhiệm vụ của tôi ({myOrders.length})
            </button>
            <button
              onClick={() => { setDriverSubTab('AVAILABLE'); setCurrentPage(1); }}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all relative ${
                driverSubTab === 'AVAILABLE' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              Đơn hàng mới ({availableOrders.length})
              {availableOrders.length > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center animate-bounce"
                  style={{ width: '18px', height: '18px', minWidth: '18px', minHeight: '18px', lineHeight: '18px' }}
                >
                  {availableOrders.length}
                </span>
              )}
            </button>
          </div>
        )}

        {/* List View */}
        <div className="flex-1 overflow-y-auto no-scrollbar relative bg-gray-50">
          {view === 'LIST' && (
            <div className="p-4 space-y-4 pb-24">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-gray-400 text-[10px] uppercase tracking-[0.2em]">
                    {driverSubTab === 'MY_TASKS' ? 'Nhiệm vụ của tôi' : 'Đơn mới chưa nhận'}
                  </h2>
                  {wakeLockRef.current && (
                    <span className="flex items-center gap-1 text-[8px] font-bold text-green-500 bg-green-50 px-1.5 py-0.5 rounded border border-green-100 animate-pulse">
                      <div className="w-1 h-1 bg-green-500 rounded-full"></div>
                      GIỮ MÀN HÌNH BẬT
                    </span>
                  )}
                </div>
                <button onClick={() => refreshData(false)} className="text-blue-500 text-[10px] font-bold uppercase tracking-wider">Làm mới</button>
              </div>

              {currentOrders.length > 0 ? (
                <>
                  {Object.entries(
                    currentOrders.reduce((acc, order) => {
                      const rId = order.routeId || 'Đơn lẻ / Chưa phân tuyến';
                      if (!acc[rId]) acc[rId] = [];
                      acc[rId].push(order);
                      return acc;
                    }, {} as Record<string, Order[]>)
                  ).map(([routeId, routeOrders]) => (
                    <div key={routeId} className="mb-6">
                       <div className="flex items-center justify-between mb-3 mx-1 bg-white p-3 rounded-xl shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-blue-50">
                           <div className="flex items-center gap-2.5">
                               <div className="w-1.5 h-4 bg-blue-500 rounded-full"></div>
                               <h3 className="font-extrabold text-blue-900 text-xs sm:text-sm uppercase tracking-wide">{routeId}</h3>
                           </div>
                           <div className="flex items-center gap-2">
                               <span className="text-[11px] font-bold bg-green-50 text-green-700 px-2.5 py-1 rounded-lg border border-green-100">
                                   {routeOrders.reduce((sum, o) => sum + (o.status === OrderStatus.DELIVERED ? (o.codTransaction?.amount ?? o.orderValue ?? 0) : (o.orderValue ?? 0)), 0).toLocaleString()}đ
                               </span>
                               <span className="text-[11px] font-bold bg-blue-50 text-blue-600 px-2.5 py-1 rounded-lg border border-blue-100">{routeOrders.length} đơn</span>
                           </div>
                       </div>
                       <div className="space-y-4">
                          {routeOrders.map((order) => {
                    const actualCOD = order.codTransaction?.amount !== undefined 
                      ? order.codTransaction.amount 
                      : ((order as any).codAmount !== undefined && (order as any).codAmount !== "" ? Number((order as any).codAmount) : null);

                    return (
                    <div key={order.id}
                               onClick={() => handleSelectOrder(order)}
                      className={`bg-white p-4 rounded-2xl shadow-sm border border-transparent hover:border-blue-200 transition-all cursor-pointer relative overflow-hidden active:bg-gray-50
                            ${order.status === OrderStatus.DELIVERED ? 'opacity-60 grayscale-[30%]' : ''}
                        `}
                    >
                      <div className={`absolute left-0 top-0 bottom-0 w-1.5 
                            ${order.status === OrderStatus.DELIVERED ? 'bg-green-500' :
                          order.status === OrderStatus.DELIVERING ? 'bg-blue-500' :
                            order.status === OrderStatus.ARRIVED ? 'bg-purple-500' : 'bg-gray-300'}
                        `}></div>

                      <div className="ml-1">
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-mono text-[10px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded border border-gray-100">{order.id}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${order.status === OrderStatus.DELIVERED ? 'text-green-600 bg-green-50 border-green-100' :
                              order.status === OrderStatus.DELIVERING ? 'text-blue-600 bg-blue-50 border-blue-100' :
                                'text-gray-500 bg-gray-50 border-gray-100'
                            }`}>
                            {statusLabels[order.status]}
                          </span>
                        </div>
                        <h3 className="font-bold text-gray-800 text-lg leading-tight mb-1">{order.customerName}</h3>
                        <div className="flex items-start gap-1.5 text-gray-500 text-sm mb-4">
                          <svg className="w-4 h-4 flex-none mt-0.5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          <p className="line-clamp-1">{order.address}</p>
                        </div>

                        <div className="flex justify-between items-center pt-3 border-t border-gray-50">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-gray-400 font-bold uppercase">Giá trị đơn</span>
                            <span className="font-bold text-gray-900 text-base">{(order.orderValue || 0).toLocaleString()} <span className="text-xs font-normal">đ</span></span>
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="text-[10px] text-gray-400 font-bold uppercase">Thực nhận</span>
                            <span className={`font-bold text-base ${actualCOD !== null ? 'text-green-600' : 'text-gray-500'}`}>
                              {actualCOD !== null ? actualCOD.toLocaleString() : '-'} <span className="text-xs font-normal">đ</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                       </div>
                    </div>
                  ))}

                  {/* THANH ĐIỀU HƯỚNG PHÂN TRANG */}
                  {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-4 mt-6">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className={`p-2 rounded-full transition-colors ${currentPage === 1 ? 'text-gray-300 bg-gray-100' : 'text-blue-600 bg-blue-50 hover:bg-blue-100 active:scale-95'}`}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
                      </button>
                      
                      <span className="text-xs font-bold text-gray-500 bg-white px-3 py-1.5 rounded-lg border border-gray-200">
                        Trang {currentPage} / {totalPages}
                      </span>

                      <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className={`p-2 rounded-full transition-colors ${currentPage === totalPages ? 'text-gray-300 bg-gray-100' : 'text-blue-600 bg-blue-50 hover:bg-blue-100 active:scale-95'}`}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                  <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center mb-6 shadow-sm border border-gray-100">
                    <svg className="w-10 h-10 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                  </div>
                  <p className="text-gray-400 font-medium">Hết nhiệm vụ cho hôm nay</p>
                </div>
              )}
            </div>
          )}

          {view === 'WALLET' && <CODReport orders={myOrders} />}
        </div>

        {/* Bottom Bar */}
        <div className="bg-white border-t border-gray-100 flex justify-around items-center p-3 pb-safe z-20 flex-none shadow-[0_-4px_10px_rgba(0,0,0,0.02)]">
          <button onClick={() => setView('LIST')} className={`flex-1 flex flex-col items-center gap-1 transition-colors ${view === 'LIST' ? 'text-blue-600' : 'text-gray-400'}`}>
            <div className={`p-1.5 rounded-xl ${view === 'LIST' ? 'bg-blue-50' : ''}`}>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            </div>
            <span className="text-[10px] font-bold">Nhiệm vụ</span>
          </button>
          <div className="flex-1 flex justify-center">
            <button className="w-14 h-14 -mt-10 bg-blue-600 rounded-2xl text-white shadow-xl flex items-center justify-center active:scale-90 transition-all border-4 border-white" onClick={() => {
              const active = myOrders.find(o => o.status === OrderStatus.DELIVERING || o.status === OrderStatus.ARRIVED);
              if (active) handleSelectOrder(active);
              else setView('LIST');
            }}>
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            </button>
          </div>
          <button onClick={() => setView('WALLET')} className={`flex-1 flex flex-col items-center gap-1 transition-colors ${view === 'WALLET' ? 'text-blue-600' : 'text-gray-400'}`}>
            <div className={`p-1.5 rounded-xl ${view === 'WALLET' ? 'bg-blue-50' : ''}`}>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            </div>
            <span className="text-[10px] font-bold">Ví tiền</span>
          </button>
        </div>
      </>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-white max-w-md mx-auto shadow-2xl overflow-hidden relative">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-full">
           <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : renderDriverContent()}
    </div>
  );
};

export default App;