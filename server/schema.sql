-- ==========================================================
-- TIKOVIA DELIVERY - DATABASE SCHEMA (POSTGRESQL 15+)
-- ==========================================================

-- Tạo database (chạy nếu chưa có):
-- CREATE DATABASE tikovia_delivery;
-- \c tikovia_delivery;

-- 1. BẢNG USERS (Tài xế, Quản lý, Kế toán)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(20) NOT NULL DEFAULT 'DRIVER', -- 'DRIVER', 'MANAGER', 'ACCOUNTANT'
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. BẢNG ORDERS (Đơn hàng giao nhận)
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(100) PRIMARY KEY,
    customer_name VARCHAR(150),
    customer_phone VARCHAR(50),
    address TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    cod_amount NUMERIC(15, 2) DEFAULT 0,
    shipping_fee NUMERIC(15, 2) DEFAULT 0,
    total_amount NUMERIC(15, 2) DEFAULT 0,
    items_summary TEXT,
    items_detail JSONB DEFAULT '[]'::jsonb,
    note TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'ASSIGNED', -- 'ASSIGNED', 'DELIVERING', 'ARRIVED', 'DELIVERED', 'CANCELED'
    driver_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    driver_name VARCHAR(100),
    pod_image_url TEXT,
    pod_signature TEXT,
    sync_google_status VARCHAR(20) DEFAULT 'SYNCED', -- 'PENDING', 'SYNCED', 'FAILED'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chỉ mục tối ưu truy vấn
CREATE INDEX IF NOT EXISTS idx_orders_driver_id ON orders(driver_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- 3. BẢNG DRIVER_LOCATIONS (Định vị Live Tài xế)
CREATE TABLE IF NOT EXISTS driver_locations (
    driver_id VARCHAR(50) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    driver_name VARCHAR(100),
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. BẢNG COD_SETTLEMENTS (Lịch sử Chốt ca thu tiền)
CREATE TABLE IF NOT EXISTS cod_settlements (
    id VARCHAR(100) PRIMARY KEY,
    driver_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    driver_name VARCHAR(100),
    shift_date DATE NOT NULL,
    total_cod_collected NUMERIC(15, 2) DEFAULT 0,
    total_orders_completed INT DEFAULT 0,
    status VARCHAR(30) DEFAULT 'APPROVED',
    approved_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. SEED DỮ LIỆU TÀI KHOẢN MẶC ĐỊNH (Tương thích Google Sheets hiện tại)
INSERT INTO users (id, username, password_hash, full_name, phone, role, status)
VALUES
    ('USR-ADMIN', 'admin', '123456', 'Quản Lý Hệ Thống', '0901234567', 'MANAGER', 'ACTIVE'),
    ('USR-KETOAN', 'ketoan', '123456', 'Kế Toán', '0907654321', 'ACCOUNTANT', 'ACTIVE'),
    ('USR-LQN', 'Lqn', '123456', 'Lê Quang Ngọc', '0912345678', 'DRIVER', 'ACTIVE'),
    ('USR-PDP', 'Pdp', '123456', 'Phạm Đình Phi', '0923456789', 'DRIVER', 'ACTIVE'),
    ('USR-GVT', 'Gvt', '123456', 'Giàng Văn Tuấn', '0934567890', 'DRIVER', 'ACTIVE'),
    ('USR-NVP', 'Nvp', '123456', 'Nguyễn Vĩnh Phú', '0945678901', 'DRIVER', 'ACTIVE'),
    ('USR-NTAK', 'Ntak', '123456', 'Ngô Tùng Anh Kha', '0956789012', 'DRIVER', 'ACTIVE'),
    ('USR-VTD', 'Vtd', '123456', 'Võ Thành Duy', '0967890123', 'DRIVER', 'ACTIVE')
ON CONFLICT (username) DO NOTHING;
