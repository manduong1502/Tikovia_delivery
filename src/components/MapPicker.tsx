import React, { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getAddressFromCoordinates, getCurrentLocation } from '../services/geoService';

interface MapPickerProps {
  onLocationSelected: (location: { lat: number; lng: number }, address: string) => void;
  onCancel: () => void;
  initialLocation?: { lat: number; lng: number };
}

const MapPicker: React.FC<MapPickerProps> = ({ onLocationSelected, onCancel, initialLocation }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [address, setAddress] = useState<string>('Đang lấy địa chỉ...');
  const [isLoading, setIsLoading] = useState(false);
  const defaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  useEffect(() => {
    if (mapRef.current && !mapInstanceRef.current) {
      getCurrentLocation()
        .then((loc) => {
          const center = initialLocation || { lat: loc.lat, lng: loc.lng };
          const map = L.map(mapRef.current!).setView([center.lat, center.lng], 15);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap',
          }).addTo(map);

          const marker = L.marker([center.lat, center.lng], { icon: defaultIcon }).addTo(map);
          markerRef.current = marker;

          // Reverse geocode initial
          updateAddress(center.lat, center.lng);

          // Click event
          map.on('click', (e: L.LeafletMouseEvent) => {
            const { lat, lng } = e.latlng;
            marker.setLatLng([lat, lng]);
            updateAddress(lat, lng);
          });

          mapInstanceRef.current = map;
        })
        .catch(() => {
          // Fallback default Da Nang
          const center = { lat: 16.047079, lng: 108.206230 };
          const map = L.map(mapRef.current!).setView([center.lat, center.lng], 13);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap',
          }).addTo(map);
          mapInstanceRef.current = map;
        });
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [initialLocation]);

  const updateAddress = async (lat: number, lng: number) => {
    setIsLoading(true);
    try {
      const addr = await getAddressFromCoordinates(lat, lng);
      setAddress(addr);
    } catch {
      setAddress(`Tọa độ: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    if (markerRef.current) {
      const { lat, lng } = markerRef.current.getLatLng();
      onLocationSelected({ lat, lng }, address);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="p-4 bg-white pt-9 shadow-md flex justify-between items-center z-10">
        <button onClick={onCancel} className="text-gray-600 font-medium px-4 py-2 bg-gray-100 rounded-full">
          Hủy
        </button>
        <h2 className="font-bold text-lg">Chọn vị trí</h2>
        <div className="w-[60px]"></div>
      </div>

      <div className="flex-1 relative">
        <div ref={mapRef} className="absolute inset-0 z-0" />
        <button
          onClick={handleConfirm}
          className="absolute bottom-5 right-0 z-[1000] shadow-lg text-blue-600 font-bold px-6 py-3 bg-white border-2 border-blue-500 rounded-full hover:bg-blue-50 active:scale-95 transition-transform"
        >
          Xác nhận
        </button>
      </div>

      <div className="p-4 bg-gray-50 border-t border-gray-200 z-10">
        <p className="font-medium text-sm text-gray-500 mb-1">Địa chỉ đã chọn:</p>
        <p className="font-bold text-gray-800 line-clamp-2">
          {isLoading ? 'Đang tải...' : address}
        </p>
      </div>
    </div>
  );
};

export default MapPicker;