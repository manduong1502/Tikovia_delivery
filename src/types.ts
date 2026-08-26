export enum OrderStatus {
  ASSIGNED = 'ASSIGNED',
  DELIVERING = 'DELIVERING',
  ARRIVED = 'ARRIVED',
  DELIVERED = 'DELIVERED',
  CANCELED = 'CANCELED'
}

export enum PaymentMethod {
  CASH = 'CASH',
  TRANSFER = 'TRANSFER',
  QR = 'QR'
}

export enum UserRole {
  MANAGER = 'MANAGER',
  DRIVER = 'DRIVER',
  ACCOUNTANT = 'ACCOUNTANT'
}

export interface User {
  id: string;
  username: string;
  password?: string;
  fullName: string;
  role: UserRole;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  location?: { lat: number; lng: number };
}

export interface GeoLocation {
  lat: number;
  lng: number;
  timestamp: number;
  accuracy?: number;
}

export interface ProofOfDelivery {
  imageUrl: string;
  timestamp: number;
  location: GeoLocation;
  address?: string; // Human readable address at point of capture
}

export interface CODTransaction {
  amount: number;
  method: PaymentMethod;
  collectedAt: number;
  discrepancy: number; // difference between order value and collected amount
}

export interface Order {
  id: string;
  customerName: string;
  customerPhone?: string;
  address: string;
  location: { lat: number; lng: number }; // Target location
  orderValue: number;
  status: OrderStatus;
  driverLocation?: GeoLocation; // Last known driver location for this order
  proofOfDelivery?: ProofOfDelivery;
  codTransaction?: CODTransaction;
  items: string[];
  driverId?: string; // ID of the assigned driver
  driverName?: string; // Display name
  orderImage?: string;
  note?: string;
  createdAt?: string | number;
  routeId?: string; // Thuộc tính tuyến giao hàng (ví dụ: Tuyến 1, Tuyến Sáng...)
  completedAtFormatted?: string; // Thời gian hoàn thành dạng dễ nhìn (VD: 18:30 21/03/2026)
  overtimeString?: string; // Thời gian tăng ca (VD: 30 phút)
}

export interface DriverStats {
  totalDelivered: number;
  totalCashCollected: number;
  totalTransferCollected: number;
  distanceTraveled: number; // in km
}

export const isTodayDate = (dateInput: any): boolean => {
    if (!dateInput) return false;
    let dateObj: Date | null = null;

    if (typeof dateInput === 'number') {
        dateObj = new Date(dateInput);
    } else {
        const dateString = String(dateInput).trim();
        if (dateString.includes('/')) {
            const parts = dateString.split(/[ /:]+/);
            if (parts.length >= 6) {
                const p5 = parseInt(parts[5], 10);
                const p2 = parseInt(parts[2], 10);
                if (p5 > 2000) {
                    dateObj = new Date(p5, parseInt(parts[4], 10) - 1, parseInt(parts[3], 10));
                } else if (p2 > 2000) {
                    dateObj = new Date(p2, parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
                } else {
                    dateObj = new Date(dateString);
                }
            } else if (parts.length >= 3) {
                const p2 = parseInt(parts[2], 10);
                if (p2 > 2000) {
                    dateObj = new Date(p2, parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
                } else {
                    dateObj = new Date(dateString);
                }
            } else {
                dateObj = new Date(dateString);
            }
        } else {
            dateObj = new Date(dateInput);
        }
    }

    if (!dateObj || isNaN(dateObj.getTime())) {
        return false;
    }

    const today = new Date();
    return (
        dateObj.getDate() === today.getDate() &&
        dateObj.getMonth() === today.getMonth() &&
        dateObj.getFullYear() === today.getFullYear()
    );
};