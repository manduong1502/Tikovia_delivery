import React, { useState, useEffect } from 'react';
import { Order, OrderStatus } from '../types';
import { getCurrentUser } from '../services/authService';
import { APP_CONFIG } from '../../config';
import CameraCapture from './CameraCapture'; // Thêm import CameraCapture

interface CODReportProps {
  orders: Order[];
}

const CODReport: React.FC<CODReportProps> = ({ orders }) => {
  const currentUser = getCurrentUser();

  const [additionalFee, setAdditionalFee] = useState<string>('');
  const [feeNote, setFeeNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const routeStorageKey = `handover_routes_${currentUser?.id}`;
  const [routeHandovers, setRouteHandovers] = useState<Array<{ id: string, name: string, image: string }>>(() => {
    const saved = localStorage.getItem(routeStorageKey);
    return saved ? JSON.parse(saved) : [{ id: '1', name: 'Tuyến 1', image: '' }];
  });
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  
  const [showFeeCamera, setShowFeeCamera] = useState(false);
  const [feeImage, setFeeImage] = useState<string>('');

  // Lưu routes vào localStorage mỗi khi thay đổi
  useEffect(() => {
      localStorage.setItem(routeStorageKey, JSON.stringify(routeHandovers));
  }, [routeHandovers, routeStorageKey]);

  const todayStrDisplay = new Date().toLocaleDateString('vi-VN');

  const now = new Date();

  const isTodayAndParse = (dateInput: any): Date | null => {
      if (!dateInput) return null;
      let dateObj: Date | null = null;
      
      const dateString = String(dateInput).trim();
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
           dateObj = new Date(dateInput);
      }

      if (!dateObj || isNaN(dateObj.getTime())) {
          return new Date();
      }

      const d = dateObj.getDate();
      const m = dateObj.getMonth();
      const y = dateObj.getFullYear();
      
      if (d === now.getDate() && m === now.getMonth() && y === now.getFullYear()) {
          return dateObj;
      }
      return null;
  };

  // Tại đây, lấy TOÀN BỘ đơn hoàn tất của ngày hôm nay thay vì chia ca
  const currentOrders = orders.filter(o => {
      if (o.status !== OrderStatus.DELIVERED) return false;
      const orderDate = isTodayAndParse(o.createdAt);
      return !!orderDate; 
  });
  
  const todayStr = new Date().toDateString();
  const submittedDataStr = localStorage.getItem('tikovia_submitted_orders');
  let submittedOrderIds: string[] = [];
  if (submittedDataStr) {
      try {
          const parsed = JSON.parse(submittedDataStr);
          if (parsed.date === todayStr) {
              submittedOrderIds = parsed.ids;
          } else {
              localStorage.removeItem('tikovia_submitted_orders');
          }
      } catch (e) {}
  }

  // Lọc ra các đơn chưa nộp
  const unsubmittedOrders = currentOrders.filter(o => !submittedOrderIds.includes(o.id));

  // Chỉ đếm đơn chưa nộp
  const totalDelivered = unsubmittedOrders.length;
  // Giữ nguyên tổng giá trị (tất cả các đơn trong ngày)
  const totalOrderValue = currentOrders.reduce((sum, o) => sum + (Number(o.orderValue) || 0), 0);
  
  // Chỉ cộng tiền của các đơn chưa nộp
  const totalCOD = unsubmittedOrders.reduce((sum, o) => {
      const localCod = o.codTransaction?.amount;
      const remoteCod = (o as any).codAmount;
      const codValue = localCod !== undefined ? localCod : remoteCod;
      return sum + (codValue !== undefined && codValue !== "" ? Number(codValue) : 0);
  }, 0);

  // Tự động điền tên tuyến (VD: Tuyến 1) thay vì để "Tuyến mới"
  useEffect(() => {
      const activeRoutes = Array.from(new Set(unsubmittedOrders.map(o => (o.routeId || '').trim()).filter(Boolean)));
      if (activeRoutes.length > 0) {
          const suggestedName = activeRoutes.join(', ');
          setRouteHandovers(prev => {
              // Chỉ tự động điền nếu người dùng chưa nhập gì hoặc đang để mặc định
              if (prev.length === 1 && (prev[0].name === 'Tuyến 1' || prev[0].name === 'Tuyến mới' || prev[0].name === '')) {
                  return [{ ...prev[0], name: suggestedName }];
              }
              return prev;
          });
      }
  }, [unsubmittedOrders.length]);

  const getRouteCOD = (routeName: string) => {
      const nameLower = routeName.trim().toLowerCase();
      if (!nameLower) return 0;
      return unsubmittedOrders
          .filter(o => (o.routeId || '').trim().toLowerCase() === nameLower)
          .reduce((sum, o) => {
              const localCod = o.codTransaction?.amount;
              const remoteCod = (o as any).codAmount;
              const codValue = localCod !== undefined ? localCod : remoteCod;
              return sum + (codValue !== undefined && codValue !== "" ? Number(codValue) : 0);
          }, 0);
  };

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

  const handleCaptureImage = async (imageData: string) => {
      setShowCamera(false);
      if (activeRouteId) {
          setRouteHandovers(prev => prev.map(r => r.id === activeRouteId ? { ...r, image: imageData } : r));
          setActiveRouteId(null);
      }
  };

  const handleCaptureFeeImage = async (imageData: string) => {
      setShowFeeCamera(false);
      setFeeImage(imageData);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, isFeeImage: boolean, targetRouteId?: string) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
          const base64Str = event.target?.result as string;
          try {
              const compressed = await compressImage(base64Str);
              if (isFeeImage) {
                  setFeeImage(compressed);
              } else if (targetRouteId) {
                  setRouteHandovers(prev => prev.map(r => r.id === targetRouteId ? { ...r, image: compressed } : r));
              }
          } catch (error) {
              console.error("Lỗi nén ảnh file:", error);
          }
      };
      reader.readAsDataURL(file);
      e.target.value = '';
  };

  const handleSubmitReport = async () => {
    if (!currentUser) {
        setSubmitMessage({ type: 'error', text: 'Không tìm thấy thông tin tài xế. Vui lòng đăng nhập lại.' });
        return;
    }

    // --- Validate: Phải có ảnh nộp tuyến ---
    const missingRouteImage = routeHandovers.some(r => !r.image);
    if (missingRouteImage) {
        setSubmitMessage({ type: 'error', text: 'Bắt buộc: Vui lòng xem lại, bạn chưa chụp ảnh xác nhận chốt cho tuyến / ca làm việc!' });
        return;
    }

    const parsedFee = parseInt(String(additionalFee).replace(/\D/g, '')) || 0;

    // --- Validate: Cấm kê khai phí nếu không có ảnh ---
    if (parsedFee > 0 && !feeImage) {
        setSubmitMessage({ type: 'error', text: 'Bắt buộc: Kê khai phí phát sinh phải đi kèm hình ảnh biên lai/xác nhận!' });
        return;
    }

    if (!window.confirm(`Bạn có chắc muốn gửi doanh thu của tuyến lên hệ thống?`)) return;

    setIsSubmitting(true);
    setSubmitMessage(null);

    // Gộp tất cả các ảnh của các tuyến
    const validImages = routeHandovers.filter(r => r.image).map(r => r.image);

    // Các tuyến nộp được đặt tên thành mảng để gửi dữ liệu
    const routeNamesSubmitted = routeHandovers.map(r => r.name).join(', ');

    const payload = {
        action: 'saveShiftReport',
        driverName: currentUser.fullName,
        driverUsername: currentUser.username,
        shiftName: `Nộp tuyến: ${routeNamesSubmitted || 'Chưa đặt tên tuyến'}`,

        totalDelivered,
        totalOrderValue,
        totalCOD,
        additionalFee: parsedFee,
        feeNote: feeNote,
        feeImage: feeImage, // Gửi ảnh phí phát sinh
        shiftImages: validImages, // Gửi mảng các ảnh tuyến nộp tiền
        timestamp: new Date().toLocaleString('vi-VN')
    };

    try {
        await fetch(APP_CONFIG.GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });
        
        // Bắt buộc bỏ qua check response.json() vì mode 'no-cors' trả về opaque response
        
        const todayStrToSave = new Date().toDateString();
        const newSubmittedIds = [...submittedOrderIds, ...unsubmittedOrders.map(o => o.id)];
        localStorage.setItem('tikovia_submitted_orders', JSON.stringify({
            date: todayStrToSave,
            ids: newSubmittedIds
        }));

        setSubmitMessage({ type: 'success', text: 'Đã gửi báo cáo chốt tuyến thành công!' });
        setAdditionalFee('');
        setFeeNote('');
        setFeeImage(''); // Xoá ảnh phí
        setRouteHandovers([{ id: Date.now().toString(), name: 'Tuyến mới', image: '' }]); // Reset

        localStorage.removeItem(routeStorageKey); // Xóa khỏi bộ nhớ đệm
    } catch (error) {
        setSubmitMessage({ type: 'error', text: 'Không thể gửi báo cáo. Vui lòng kiểm tra mạng.' });
    } finally {
        setIsSubmitting(false);
    }
  };

  // Render camera UI nếu bấm chụp
  if (showCamera && activeRouteId) {
      return <CameraCapture onCapture={handleCaptureImage} onCancel={() => setShowCamera(false)} />;
  }
  if (showFeeCamera) {
      return <CameraCapture onCapture={handleCaptureFeeImage} onCancel={() => setShowFeeCamera(false)} />;
  }

  return (
    <div className="p-4 space-y-5 pb-24">
      <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-800">Kết thúc tuyến</h2>
          <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap">
            Nộp liên tục
          </span>
      </div>
      
      {/* Thẻ Tổng quan */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 rounded-full bg-white opacity-10"></div>
        <div className="absolute bottom-0 right-10 -mb-4 w-16 h-16 rounded-full bg-white opacity-10"></div>

        <p className="text-blue-100 text-sm font-medium mb-1">Tổng tiền mặt thực nhận (COD)</p>
        <div className="text-4xl font-extrabold tracking-tight mb-4">
            {totalCOD.toLocaleString()} <span className="text-lg font-normal text-blue-200">đ</span>
        </div>
        
        <div className="grid grid-cols-2 gap-4 border-t border-white/20 pt-4 mt-2">
            <div>
                <p className="text-blue-200 text-xs uppercase font-bold tracking-wider mb-1">Đã giao</p>
                <p className="font-bold text-lg">{totalDelivered} <span className="text-sm font-normal">đơn</span></p>
            </div>
            <div>
                <p className="text-blue-200 text-xs uppercase font-bold tracking-wider mb-1">Tổng giá trị</p>
                <p className="font-bold text-lg">{totalOrderValue.toLocaleString()} <span className="text-sm font-normal">đ</span></p>
            </div>
        </div>
      </div>

      {/* Form nhập phí phát sinh */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h3 className="font-bold text-gray-800 border-b border-gray-100 pb-2">Kê khai phí phát sinh</h3>
          
          <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Số tiền (VND)</label>
              <div className="relative">
                  <input 
                      type="text" 
                      inputMode="numeric"
                      value={additionalFee}
                      onChange={(e) => {
                          const raw = e.target.value.replace(/\D/g, '');
                          setAdditionalFee(raw ? parseInt(raw, 10).toLocaleString('en-US') : '');
                      }}
                      placeholder="VD: 50,000"
                      className="w-full pl-4 pr-10 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono text-lg"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">đ</span>
              </div>
          </div>

          <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Lý do / Ghi chú</label>
              <input 
                  type="text" 
                  value={feeNote}
                  onChange={(e) => setFeeNote(e.target.value)}
                  placeholder="Tiền gửi xe, đổ xăng, ứng khách..."
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm mb-3"
              />
          </div>

          {/* Nút chụp ảnh phí phát sinh */}
          <div className="flex items-center justify-between mt-2 py-2 border-t border-gray-100">
              <div>
                 <p className="text-xs font-bold text-gray-700">Hình ảnh</p>
              </div>
              <div className="flex gap-2">
                  <label className="cursor-pointer text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 border transition-all text-gray-700 bg-gray-50 border-gray-200 hover:bg-gray-100">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                      Tải lên
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, true)} />
                  </label>
                  <button
                      type="button"
                      onClick={() => setShowFeeCamera(true)}
                      className={`text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 border transition-all
                          ${feeImage
                              ? 'text-green-600 bg-green-50 border-green-200'
                              : 'text-blue-600 bg-blue-50 border-blue-100 hover:bg-blue-100'}`}
                  >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      {feeImage ? 'Đã chụp' : 'Chụp'}
                  </button>
              </div>
          </div>
          
          {feeImage && (
              <div className="relative inline-block mt-2">
                  <img src={feeImage} alt="Fee preview" className="w-24 h-24 object-cover rounded-lg border border-gray-200 shadow-sm" />
                  <button
                      type="button"
                      onClick={() => setFeeImage('')}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600"
                  >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
              </div>
          )}
      </div>

      {/* Khu vực chụp ảnh nộp tiền theo tuyến */}
      <div className="bg-gradient-to-br from-[#f8fafc] to-[#f1f5f9] rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-200/60 p-5 space-y-4">
          <div className="flex items-start justify-between">
               <div className="flex gap-3 items-center">
                   <div className="w-10 h-10 rounded-2xl bg-white shadow-sm flex items-center justify-center flex-none border border-gray-100">
                       <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                   </div>
                   <div>
                     <h3 className="font-extrabold text-gray-800 text-base">Nộp Kế Toán</h3>
                     <p className="text-[11px] font-medium text-gray-500 mt-0.5 leading-tight uppercase tracking-wider">Chia theo tuyến</p>
                   </div>
               </div>
               <button
                  onClick={() => setRouteHandovers([...routeHandovers, { id: Date.now().toString(), name: `Tuyến ${routeHandovers.length + 1}`, image: '' }])}
                  className="bg-blue-600 text-white px-3 py-2 rounded-xl text-xs font-bold hover:bg-blue-700 shadow-[0_4px_12px_rgba(37,99,235,0.25)] active:scale-95 transition-all flex items-center gap-1.5"
               >
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                 Tạo mới
               </button>
          </div>
          
          <div className="space-y-4 mt-4 relative">
              {routeHandovers.map((route, index) => (
                  <div key={route.id} className="bg-white rounded-2xl p-4 border border-blue-50 shadow-[0_4px_15px_rgba(59,130,246,0.06)] relative group transition-all hover:shadow-[0_6px_20px_rgba(59,130,246,0.12)] hover:border-blue-100 flex flex-col gap-3">
                       {routeHandovers.length > 1 && (
                            <button
                                onClick={() => setRouteHandovers(prev => prev.filter(r => r.id !== route.id))}
                                className="absolute -top-3 -right-3 bg-red-50 text-red-500 hover:bg-red-500 hover:text-white rounded-full p-2 shadow-sm transition-all border border-red-100 z-10"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                       )}
                       
                       <div className="flex items-center gap-2">
                           <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm border border-blue-100 shadow-inner flex-none">
                               {index + 1}
                           </div>
                           <div className="flex flex-col w-full">
                               <input 
                                   type="text" 
                                   value={route.name} 
                                   onChange={(e) => setRouteHandovers(prev => prev.map(r => r.id === route.id ? { ...r, name: e.target.value } : r))}
                                   className="font-extrabold text-gray-800 text-lg bg-transparent border-b-2 border-transparent hover:border-gray-200 focus:border-blue-500 outline-none w-full py-1 transition-colors"
                                   placeholder="VD: Tuyến 1..."
                               />
                               {route.name.trim() && getRouteCOD(route.name) > 0 && (
                                   <div className="text-[13px] font-bold text-green-600 mt-1.5 flex items-center gap-1.5 bg-green-50 self-start px-2 py-0.5 rounded border border-green-100">
                                       <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                       <span>Số tiền thu hộ tuyến này: <span className="text-sm">{getRouteCOD(route.name).toLocaleString()} đ</span></span>
                                   </div>
                               )}
                           </div>
                       </div>
                       
                       <div className="flex gap-2 w-full mt-1">
                            <button
                                type="button"
                                onClick={() => {
                                    setActiveRouteId(route.id);
                                    setShowCamera(true);
                                }}
                                className={`flex-1 flex font-bold py-3 px-4 rounded-xl items-center justify-center gap-2 transition-all shadow-sm relative overflow-hidden active:scale-95
                                    ${route.image
                                        ? 'text-white bg-gradient-to-r from-emerald-500 to-green-600 shadow-[0_4px_12px_rgba(16,185,129,0.3)]'
                                        : 'text-white bg-gradient-to-r from-blue-500 to-indigo-600 shadow-[0_4px_12px_rgba(59,130,246,0.3)]'}`}
                            >
                                {route.image && <div className="absolute inset-0 bg-white opacity-20 w-1/2 skew-x-12 translate-x-[-200%] animate-[shine_2s_infinite]"></div>}
                                <svg className="w-5 h-5 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><circle cx="12" cy="13" r="3" fill="currentColor"/></svg>
                                <span className="relative z-10 whitespace-nowrap">{route.image ? 'Chụp lại' : 'Chụp ảnh'}</span>
                            </button>

                            <label className="cursor-pointer font-bold px-4 py-3 rounded-xl flex items-center justify-center transition-all text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 shadow-sm active:scale-95 flex-none block">
                                <svg className="w-5 h-5 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, false, route.id)} />
                            </label>
                       </div>
                       
                       {route.image && (
                           <div className="relative mt-2 rounded-xl overflow-hidden shadow-inner border border-gray-100 group cursor-pointer" onClick={() => { setActiveRouteId(route.id); setShowCamera(true); }}>
                               <img src={route.image} alt="Route preview" className="w-full h-[120px] object-cover transition-transform duration-500 group-hover:scale-105" />
                               <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-[2px]">
                                   <div className="bg-white/20 p-2.5 rounded-full border border-white/40 text-white backdrop-blur-md">
                                       <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                                   </div>
                               </div>
                               <div className="absolute bottom-2 right-2 bg-green-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow backdrop-blur-md border border-green-400/50 flex items-center gap-1">
                                   <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                   Đã lưu ảnh
                               </div>
                           </div>
                       )}
                  </div>
              ))}
          </div>
      </div>

      {/* Nút Submit */}
      <div className="pt-2">
          {submitMessage && (
              <div className={`p-3 rounded-xl text-sm font-medium mb-4 flex items-center gap-2 ${submitMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  {submitMessage.type === 'success' ? (
                      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  ) : (
                      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  )}
                  {submitMessage.text}
              </div>
          )}

          <button 
              onClick={handleSubmitReport}
              disabled={isSubmitting || totalDelivered === 0}
              className={`w-full py-4 rounded-xl text-white font-bold text-lg shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2
                  ${isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 
                    totalDelivered === 0 ? 'bg-blue-300 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
          >
              {isSubmitting ? (
                  <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Đang xử lý...
                  </>
              ) : (
                  <>
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {totalDelivered === 0 ? 'Chưa có đơn hoàn thành hôm nay' : 'Gửi doanh thu tuyến lên hệ thống'}
                  </>
              )}
          </button>
      </div>
    </div>
  );
};

export default CODReport;