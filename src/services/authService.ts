import { User, UserRole } from '../types';
import { APP_CONFIG } from '../../config'; // Import config của bạn

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

// Thêm tham số remember để quyết định nơi lưu
export const login = async (username: string, password: string, remember: boolean = true): Promise<User> => {
    const users = await fetchAuthAPI('GET', 'getUsers');
    
    if (!Array.isArray(users)) {
        throw new Error("Lỗi kết nối máy chủ hoặc API chưa cập nhật");
    }
    
    // --- ĐÃ SỬA Ở ĐÂY: Ép kiểu về chuỗi (String) và cắt khoảng trắng (trim) ---
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
    
    // Fallback cho admin mặc định (giữ nguyên)
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
        sessionStorage.removeItem(CURRENT_USER_KEY); // Xóa cả session
        resolve();
    });
};

export const getCurrentUser = (): User | null => {
    // Ưu tiên check localStorage trước, sau đó tới sessionStorage
    const stored = localStorage.getItem(CURRENT_USER_KEY) || sessionStorage.getItem(CURRENT_USER_KEY);
    return stored ? JSON.parse(stored) : null;
};

export const getAllDrivers = async (): Promise<User[]> => {
    const users = await fetchAuthAPI('GET', 'getUsers');
    return users.filter((u: any) => u.role === UserRole.DRIVER);
};

export const createDriver = async (data: Pick<User, 'username' | 'password' | 'fullName'>): Promise<User> => {
    const payload = { username: data.username, password: data.password, fullName: data.fullName, role: UserRole.DRIVER };
    const result = await fetchAuthAPI('POST', 'saveUser', payload);
    if (result.status === 'error') throw new Error(result.message || "Lỗi khi tạo tài khoản");
    return result.user as User;
};


export const getShiftReports = async () => {
    return await fetchAuthAPI('GET', 'getShiftReports');
};

export const getExpenses = async () => {
    return await fetchAuthAPI('GET', 'getExpenses');
};

export const saveExpenses = async (expenses: any[], accountantName: string) => {
    const payload = { expenses, accountantName };
    const result = await fetchAuthAPI('POST', 'saveExpenses', payload);
    if (result.status === 'error') throw new Error(result.message || "Lỗi khi lưu khoản chi");
    return result;
};

export const confirmShiftReport = async (reportId: string) => {
    const result = await fetchAuthAPI('POST', 'confirmShiftReport', { reportId });
    if (result.status === 'error') throw new Error(result.message || "Lỗi khi xác nhận");
    return result;
};