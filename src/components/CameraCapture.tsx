
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { getAddressFromCoordinates } from '../services/geoService';
import { GeoLocation } from '../types';

interface CameraCaptureProps {
  onCapture: (imageData: string, address: string, cachedLocation: GeoLocation | null) => void;
  onCancel: () => void;
}

const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real-time overlay state
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentLoc, setCurrentLoc] = useState<GeoLocation | null>(null);
  const [currentAddress, setCurrentAddress] = useState<string>("Đang tìm tín hiệu GPS...");
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // REALTIME LOCATION TRACKING
  useEffect(() => {
    if (!navigator.geolocation) {
      setCurrentAddress("Trình duyệt không hỗ trợ GPS");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const loc: GeoLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp
        };
        setCurrentLoc(loc);
        setGpsAccuracy(position.coords.accuracy);

        // Update address if location changes or not yet set
        if (currentAddress === "Đang tìm tín hiệu GPS..." || currentAddress.includes("Tọa độ:")) {
          const address = await getAddressFromCoordinates(loc.lat, loc.lng);
          setCurrentAddress(address);
        }
      },
      (err) => {
        console.error("GPS Watch Error:", err);
        if (currentAddress === "Đang tìm tín hiệu GPS...") {
          setCurrentAddress("Lỗi định vị. Vui lòng bật vị trí.");
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [currentAddress]);

  // Periodic address refresh
  useEffect(() => {
    const interval = setInterval(async () => {
      if (currentLoc) {
        const address = await getAddressFromCoordinates(currentLoc.lat, currentLoc.lng);
        setCurrentAddress(address);
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [currentLoc]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsStreaming(true);
      }
    } catch (err) {
      console.error("Camera error:", err);
      setError("Không thể truy cập camera. Vui lòng cấp quyền.");
    }
  }, []);

  const wrapText = (context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
    const words = (text || "").split(' ');
    let line = '';
    let currentY = y;
    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = context.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        context.fillText(line, x, currentY);
        line = words[n] + ' ';
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    context.fillText(line, x, currentY);
  };

  const takePhoto = async () => {
    if (videoRef.current && canvasRef.current && !isCapturing && isStreaming) {
      setIsCapturing(true);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      try {
        if (context) {
          // Tối ưu hóa: Thu nhỏ ảnh trực tiếp trên canvas gốc để upload nhanh nhất có thể.
          const MAX_WIDTH = 320;
          let targetWidth = video.videoWidth;
          let targetHeight = video.videoHeight;

          if (targetWidth > MAX_WIDTH) {
            targetHeight = Math.floor(targetHeight * (MAX_WIDTH / targetWidth));
            targetWidth = MAX_WIDTH;
          }

          canvas.width = targetWidth;
          canvas.height = targetHeight;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Watermark Data
          const timestampStr = new Date().toLocaleString('vi-VN');
          const addressStr = currentAddress || "Vị trí không xác định";
          const latLngStr = currentLoc
            ? `${currentLoc.lat.toFixed(6)}, ${currentLoc.lng.toFixed(6)} (±${Math.round(currentLoc.accuracy || 0)}m)`
            : "Không có tọa độ";

          const baseFontSize = Math.max(canvas.width * 0.025, 12); // Resize font nhỏ theo màn
          const lineHeight = baseFontSize * 1.5;
          const paddingX = 15;
          const barHeight = lineHeight * 5.5;

          // Background bar
          context.fillStyle = 'rgba(0, 0, 0, 0.75)';
          context.fillRect(0, canvas.height - barHeight, canvas.width, barHeight);

          // White text
          context.fillStyle = 'white';
          context.textBaseline = 'top';

          let cursorY = canvas.height - barHeight + 10;

          context.font = `bold ${baseFontSize}px Arial`;
          context.fillText(timestampStr, paddingX, cursorY);

          cursorY += lineHeight;
          context.font = `${baseFontSize * 0.8}px monospace`;
          context.fillStyle = '#4ade80';
          context.fillText(latLngStr, paddingX, cursorY);

          cursorY += lineHeight;
          context.font = `${baseFontSize * 0.9}px Arial`;
          context.fillStyle = 'white';
          wrapText(context, addressStr, paddingX, cursorY, canvas.width - (paddingX * 2), lineHeight);

          const dataUrl = canvas.toDataURL('image/jpeg', 0.5); // Nén mạnh thêm về 50%

          const stream = video.srcObject as MediaStream;
          stream?.getTracks().forEach(track => track.stop());

          onCapture(dataUrl, addressStr, currentLoc);
        }
      } catch (e) {
        console.error("Capture failed", e);
        setIsCapturing(false);
      }
    }
  };

  React.useEffect(() => {
    startCamera();
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [startCamera]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="relative flex-1 bg-black overflow-hidden flex items-center justify-center">
        {error ? (
          <div className="p-6 text-center text-white">
            <p className="mb-4">{error}</p>
            <button onClick={onCancel} className="px-6 py-2 bg-white text-black font-bold rounded-full">Quay lại</button>
          </div>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="absolute w-full h-full object-cover" />
            <canvas ref={canvasRef} className="hidden" />

            <div className="absolute top-4 left-4 right-4 z-10">
              <div className="flex items-center justify-between">
                <div className="bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/20 flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${gpsAccuracy && gpsAccuracy < 20 ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}></div>
                  <span className="text-[10px] text-white font-bold uppercase tracking-wider">
                    GPS: {gpsAccuracy ? `±${Math.round(gpsAccuracy)}m` : 'Tìm kiếm...'}
                  </span>
                </div>
              </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-6 text-white z-10 pointer-events-none">
              <div className="font-mono text-lg font-bold text-yellow-400 mb-1 drop-shadow-md">
                {currentTime.toLocaleString('vi-VN')}
              </div>

              <div className="flex items-start gap-2 text-xs text-gray-100">
                <svg className="w-4 h-4 flex-none mt-0.5 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
                <span className="font-medium leading-relaxed drop-shadow-sm line-clamp-2 italic">
                  {currentAddress}
                </span>
              </div>
            </div>

            {isCapturing && (
              <div className="absolute inset-0 bg-black/70 z-20 flex flex-col items-center justify-center">
                <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin mb-4"></div>
                <div className="text-white font-bold text-sm tracking-widest uppercase">Đang ghi nhận vị trí...</div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="h-32 bg-black flex items-center justify-around px-8 pb-safe pt-2 border-t border-white/10">
        <button
          onClick={onCancel}
          className="text-white/60 hover:text-white font-bold text-sm uppercase tracking-wider p-4"
          disabled={isCapturing}
        >
          Hủy
        </button>

        <button
          onClick={takePhoto}
          disabled={isCapturing || !isStreaming}
          className={`relative w-20 h-20 rounded-full border-4 flex items-center justify-center active:scale-90 transition-all
            ${isCapturing || !isStreaming
              ? 'border-white/20 opacity-50'
              : 'border-white bg-white/10 shadow-[0_0_20px_rgba(255,255,255,0.2)]'}`}
        >
          <div className="w-14 h-14 bg-white rounded-full"></div>
        </button>

        <div className="w-16"></div>
      </div>
    </div>
  );
};

export default CameraCapture;
