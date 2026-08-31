import { User, UserRole } from '../types';
import { APP_CONFIG, isServerMode } from '../../config';

const CURRENT_USER_KEY = 'smartlogistics_current_user';
const SCRIPT_URL = APP_CONFIG.GOOGLE_SCRIPT_URL;

const fetchAuthAPI = async (method: string, action: string, data?: any) => {
    if (!SCRIPT_URL) throw new Error("Chưa cấu hình GOOGLE_SCRIPT_URL");
    
    try {
        if (method === 'GET') {
            const response = await fetch(`${SCRIPT_URL}?action=${action}`);
            return await response.json();
        } else {
            const response = await fetch(SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action, ...data })
            });
            return await response.json();
        }
    } catch (error) {
        console.error("Lỗi khi kết nối Google Sheet API:", error);
        throw new Error("Lỗi kết nối máy chủ");
    }
};

// 1. ĐĂNG NHẬP
export const login = async (username: string, password: string, remember: boolean = true): Promise<User> => {
    // Thử kết nối Backend PostgreSQL trước
    if (isServerMode()) {
        try {
            const res = await fetch(`${APP_CONFIG.API_BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            if (res.ok) {
                const user = await res.json();
                const safeUser: User = {
                    id: user.id,
                    username: user.username,
                    fullName: user.fullName,
                    role: user.role || UserRole.DRIVER
                };
                if (remember) {
                    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(safeUser));
                } else {
                    sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(safeUser));
                }
                return safeUser;
            } else if (res.status === 401) {
                throw new Error("Sai tên đăng nhập hoặc mật khẩu");
            }
        } catch (err: any) {
            if (err.message === "Sai tên đăng nhập hoặc mật khẩu") throw err;
            console.warn("Backend login error, falling back to Google Sheets:", err);
        }
    }

    // Fallback: Google Sheets
    const users = await fetchAuthAPI('GET', 'getUsers');
    if (!Array.isArray(users)) {
        throw new Error("Lỗi kết nối máy chủ hoặc API chưa cập nhật");
    }
    
    const user = users.find((u: any) => 
        String(u.username).trim() === String(username).trim() && 
        String(u.password).trim() === String(password).trim()
    );
    
    if (user) {
        const safeUser = { id: user.id, username: user.username, fullName: user.fullName, role: user.role || UserRole.DRIVER };
        if (remember) {
            localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(safeUser));
        } else {
            sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(safeUser));
        }
        return safeUser as User;
    } 
    
    // Fallback mặc định nếu chưa seed
    if (username === 'admin' && password === '123' && users.length === 0) {
        const adminFallback = { id: 'admin-1', username: 'admin', fullName: 'Quản Lý Hệ Thống', role: UserRole.MANAGER };
        if (remember) {
            localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(adminFallback));
        } else {
            sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(adminFallback));
        }
        return adminFallback as User;
    }

    throw new Error("Sai tên đăng nhập hoặc mật khẩu");
};

export const logout = (): Promise<void> => {
    return new Promise((resolve) => {
        localStorage.removeItem(CURRENT_USER_KEY);
        sessionStorage.removeItem(CURRENT_USER_KEY);
        resolve();
    });
};

export const getCurrentUser = (): User | null => {
    const stored = localStorage.getItem(CURRENT_USER_KEY) || sessionStorage.getItem(CURRENT_USER_KEY);
    return stored ? JSON.parse(stored) : null;
};

// 2. DANH SÁCH TÀI XẾ
export const getAllDrivers = async (): Promise<User[]> => {
    if (isServerMode()) {
        try {
            const res = await fetch(`${APP_CONFIG.API_BASE_URL}/api/users/drivers`);
            if (res.ok) {
                const drivers = await res.json();
                if (Array.isArray(drivers)) return drivers;
            }
        } catch (e) {
            console.warn("Backend getAllDrivers error, falling back:", e);
        }
    }

    const users = await fetchAuthAPI('GET', 'getUsers');
    return users.filter((u: any) => u.role === UserRole.DRIVER);
};

// 3. TẠO TÀI XẾ MỚI
export const createDriver = async (data: Pick<User, 'username' | 'password' | 'fullName'>): Promise<User> => {
    if (isServerMode()) {
        try {
            const res = await fetch(`${APP_CONFIG.API_BASE_URL}/api/users/drivers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {
            console.warn("Backend createDriver error, falling back:", e);
        }
    }

    const payload = { username: data.username, password: data.password || '12345', fullName: data.fullName, role: UserRole.DRIVER };
    const result = await fetchAuthAPI('POST', 'saveUser', payload);
    if (result.status === 'error') throw new Error(result.message || "Lỗi khi tạo tài khoản");
    return result.user as User;
};

// 4. BÁO CÁO CHỐT CA / NỘP TUYẾN
export const getShiftReports = async () => {
    if (isServerMode()) {
        try {
            const res = await fetch(`${APP_CONFIG.API_BASE_URL}/api/shifts`);
            if (res.ok) {
                const reports = await res.json();
                if (Array.isArray(reports)) return reports;
            }
        } catch (e) {
            console.warn("Backend getShiftReports error, falling back:", e);
        }
    }
    return await fetchAuthAPI('GET', 'getShiftReports');
};

export const confirmShiftReport = async (reportId: string) => {
    if (isServerMode()) {
        try {
            const res = await fetch(`${APP_CONFIG.API_BASE_URL}/api/shifts/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reportId })
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {
            console.warn("Backend confirmShiftReport error, falling back:", e);
        }
    }
    const result = await fetchAuthAPI('POST', 'confirmShiftReport', { reportId });
    if (result.status === 'error') throw new Error(result.message || "Lỗi khi xác nhận");
    return result;
};

// 5. KHOẢN CHI PHÍ KẾ TOÁN
export const getExpenses = async () => {
    if (isServerMode()) {
        try {
            const res = await fetch(`${APP_CONFIG.API_BASE_URL}/api/expenses`);
            if (res.ok) {
                const exps = await res.json();
                if (Array.isArray(exps)) return exps;
            }
        } catch (e) {
            console.warn("Backend getExpenses error, falling back:", e);
        }
    }
    return await fetchAuthAPI('GET', 'getExpenses');
};

export const saveExpenses = async (expenses: any[], accountantName: string) => {
    if (isServerMode()) {
        try {
            const res = await fetch(`${APP_CONFIG.API_BASE_URL}/api/expenses`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expenses, accountantName })
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {
            console.warn("Backend saveExpenses error, falling back:", e);
        }
    }
    const payload = { expenses, accountantName };
    const result = await fetchAuthAPI('POST', 'saveExpenses', payload);
    if (result.status === 'error') throw new Error(result.message || "Lỗi khi lưu khoản chi");
    return result;
};