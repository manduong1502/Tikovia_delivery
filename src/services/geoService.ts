import { GeoLocation } from '../types';

// Haversine formula to calculate distance in meters
export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371e3; 
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

export const getCurrentLocation = (): Promise<GeoLocation> => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not available'));
    const timer = setTimeout(() => reject(new Error('Geolocation timeout')), 10000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        // Đánh dấu đã cấp quyền thành công
        localStorage.setItem('gps_permission_granted', 'true');
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 0,
          timestamp: pos.timestamp || Date.now(),
        });
      },
      (err) => {
        clearTimeout(timer);
        localStorage.removeItem('gps_permission_granted');
        reject(new Error('Người dùng từ chối cấp quyền thông qua trình duyệt hoặc thiết bị tắt GPS.'));
      },
      { enableHighAccuracy: true, maximumAge: 0 }
    );
  });
};

export const getRoadRoute = async (
    start: { lat: number; lng: number }, 
    end: { lat: number; lng: number }
): Promise<{ distance: number; geometry: any } | null> => {
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            return {
                distance: data.routes[0].distance,
                geometry: data.routes[0].geometry
            };
        }
        return null;
    } catch (error) {
        return null;
    }
};

export const getAddressFromCoordinates = async (lat: number, lng: number): Promise<string> => {
    if (lat === 0 && lng === 0) return "Tọa độ không hợp lệ";
    
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
        
        const response = await fetch(url, {
            headers: {
                'Accept-Language': 'vi-VN',
                'User-Agent': 'SmartLogisticsPro/1.0'
            }
        });

        if (!response.ok) throw new Error("Map API error");
        
        const data = await response.json();
        
        if (data && data.display_name) {
            return data.display_name;
        }
        return `Tọa độ: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    } catch (error) {
        console.error("Reverse geocoding error:", error);
        return `Tọa độ: ${lat.toFixed(6)}, ${lng.toFixed(6)}`; 
    }
};

// Thêm mới: Geocode address to lat/lng using Nominatim (OpenStreetMap)
export const geocodeAddress = async (address: string): Promise<{ lat: number; lng: number }> => {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&addressdetails=1`;
    
    const response = await fetch(url, {
      headers: {
        'Accept-Language': 'vi-VN',
        'User-Agent': 'SmartLogisticsPro/1.0'
      }
    });

    if (!response.ok) throw new Error("Geocode API error");
    
    const data = await response.json();
    
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
      };
    }
    throw new Error('No results found');
  } catch (error) {
    console.error("Geocoding error:", error);
    // Fallback to a default location (e.g., Da Nang)
    return { lat: 16.047079, lng: 108.206230 };
  }
};