import React, { useEffect, useRef } from 'react';
import * as L from 'leaflet'; // Import Leaflet từ npm
import 'leaflet/dist/leaflet.css'; // Import CSS từ npm

import { GeoLocation } from '../types';
import { getRoadRoute } from '../services/geoService';

interface MapTrackerProps {
  currentLocation: GeoLocation | null;
  targetLocation: { lat: number; lng: number };
  checkInRadius: number;
  onDistanceChange?: (meters: number) => void;
}

const MapTracker: React.FC<MapTrackerProps> = ({ currentLocation, targetLocation, checkInRadius, onDistanceChange }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null); // Sử dụng type từ Leaflet
  const driverMarkerRef = useRef<L.Marker | null>(null);
  const targetMarkerRef = useRef<L.Marker | null>(null);
  const routeLayerRef = useRef<L.Layer | null>(null); // Layer có thể là GeoJSON hoặc Polyline

  // Sử dụng vị trí mặc định nếu không có vị trí hiện tại (cho phát triển)
  // Default to Hòa Xuân, Đà Nẵng when no current location available
  const displayLocation = currentLocation || { 
    lat: 16.0340, 
    lng: 108.1850, 
    timestamp: Date.now(),
    accuracy: 0 
  };

  useEffect(() => {
    if (mapContainerRef.current && !mapInstanceRef.current) {
      try {
        // Khởi tạo map với view trên vị trí hiện tại, sẽ fit bounds sau
        const map = L.map(mapContainerRef.current, {
          zoomControl: false,
          attributionControl: false
        }).setView([displayLocation.lat, displayLocation.lng], 15);

        mapInstanceRef.current = map;

        // Nạp layer bản đồ
        const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          minZoom: 1
        }).addTo(map);

        // Debug tile errors
        tileLayer.on('tileerror', (error) => {
          console.error('Tile load error:', error);
        });
        tileLayer.on('tileload', () => {
          console.log('Tile loaded successfully');
        });

        // QUAN TRỌNG: Ép map tính lại kích thước sau khi render
        const resizeObserver = new ResizeObserver(() => {
          if (mapInstanceRef.current) {
            mapInstanceRef.current.invalidateSize(false);
          }
        });
        resizeObserver.observe(mapContainerRef.current);

        // Trigger resize sau khi khởi tạo
        setTimeout(() => {
          if (mapInstanceRef.current) {
            mapInstanceRef.current.invalidateSize(true);
          }
        }, 50);

        return () => {
          resizeObserver.disconnect();
          if (mapInstanceRef.current) {
            // Dọn dẹp các layer trước khi destroy map để tránh lỗi leaflet
            if (driverMarkerRef.current) {
               driverMarkerRef.current.remove();
               driverMarkerRef.current = null;
            }
            if (targetMarkerRef.current) {
               targetMarkerRef.current.remove();
               targetMarkerRef.current = null;
            }
            if (routeLayerRef.current) {
               mapInstanceRef.current.removeLayer(routeLayerRef.current);
               routeLayerRef.current = null;
            }
            
            mapInstanceRef.current.remove();
            mapInstanceRef.current = null;
          }
        };
      } catch (error) {
        console.error('Lỗi khởi tạo map:', error);
        return undefined;
      }
    } else {
      return undefined;
    }
  }, []); // Chỉ init một lần

  // Effect to update driver position and fetch route
  useEffect(() => {
    if (mapInstanceRef.current) {
      const map = mapInstanceRef.current;

      // Update Driver Marker (Blue Pulse)
      if (driverMarkerRef.current) {
        driverMarkerRef.current.setLatLng([displayLocation.lat, displayLocation.lng]);
      } else {
        const driverIcon = L.divIcon({
          className: 'driver-icon',
          html: `<div style="background-color: #2563eb; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.3);"></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });
        driverMarkerRef.current = L.marker([displayLocation.lat, displayLocation.lng], { icon: driverIcon }).addTo(map);
      }

      // Add Target Marker (Red location pin)
      if (!targetMarkerRef.current) {
        const targetIcon = L.divIcon({
          className: 'target-icon',
          html: `<div style="background-color: #ef4444; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.3);"></div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });
        targetMarkerRef.current = L.marker([targetLocation.lat, targetLocation.lng], { icon: targetIcon }).addTo(map);
      } else {
        targetMarkerRef.current.setLatLng([targetLocation.lat, targetLocation.lng]);
      }

      // Fetch and Draw Real Road Route
      const updateRoute = async () => {
        const routeData = await getRoadRoute(
          { lat: displayLocation.lat, lng: displayLocation.lng },
          targetLocation
        );

        // NẾU MAP ĐÃ BỊ UNMOUNT TRONG LÚC ĐỢI API TRẢ VỀ THÌ BỎ QUA NGAY
        if (!mapInstanceRef.current) return;

        if (routeData) {
          // Update distance in parent component
          if (onDistanceChange) onDistanceChange(routeData.distance);

          // Draw Route
          if (routeLayerRef.current && mapInstanceRef.current.hasLayer(routeLayerRef.current)) {
            mapInstanceRef.current.removeLayer(routeLayerRef.current);
          }

          routeLayerRef.current = L.geoJSON(routeData.geometry, {
            style: {
              color: '#3b82f6', // Blue route
              weight: 4,
              opacity: 0.7
            }
          }).addTo(mapInstanceRef.current);
        } else {
          // Fallback: simple line if API fails
          if (routeLayerRef.current && mapInstanceRef.current.hasLayer(routeLayerRef.current)) {
              mapInstanceRef.current.removeLayer(routeLayerRef.current);
          }
          routeLayerRef.current = L.polyline([
            [displayLocation.lat, displayLocation.lng],
            [targetLocation.lat, targetLocation.lng]
          ], { color: '#64748b', weight: 3, dashArray: '5, 10' }).addTo(mapInstanceRef.current);
        }

        // Ép invalidateSize lại để chắc chắn
        mapInstanceRef.current.invalidateSize();
      };

      updateRoute();

      // Fit bounds to show both current location and target
      const bounds = L.latLngBounds([
        [displayLocation.lat, displayLocation.lng],
        [targetLocation.lat, targetLocation.lng]
      ]);
      setTimeout(() => {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      }, 100);
    }
  }, [currentLocation, targetLocation, onDistanceChange]);

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-gray-200 shadow-inner" style={{ height: '300px', minHeight: '300px', display: 'flex' }}>
      <div 
        ref={mapContainerRef} 
        style={{ 
          width: '100%', 
          height: '100%', 
          flex: 1
        }} 
      />
      <div className="absolute top-2 right-2 bg-white/90 px-2 py-1 rounded text-xs font-bold text-gray-600 shadow z-10">
        OpenStreetMap
      </div>
    </div>
  );
};

export default MapTracker;