// Cấu hình kết nối
// BẠN DÁN URL GOOGLE APPS SCRIPT VÀO DƯỚI ĐÂY
// Ví dụ: 'https://script.google.com/macros/s/AKfycbx.../exec'

export const APP_CONFIG = {
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxIN0yxGmHN2GELHmaiGkfeekOyQt8sJjUNU_gRqOBtgcqZfb98P6J3qQK_pGWlGG0l/exec', // <--- DÁN LINK CỦA BẠN VÀO GIỮA 2 DẤU NHÁY NÀY
    
    // Backend API Mini Server Ubuntu (Cloudflare Tunnel)
    API_BASE_URL: 'https://api-delivery.tikovia.vn', 
    DRIVER_SHARED_SECRET: 'tikovia-driver-secure-key-2026-change-me',
};

export const isGoogleMode = () => {
    return APP_CONFIG.GOOGLE_SCRIPT_URL.length > 0;
};

export const isServerMode = () => {
    return APP_CONFIG.API_BASE_URL.length > 0;
};