-- ==========================================================
-- TIKOVIA DELIVERY - DATABASE SCHEMA (POSTGRESQL 15+)
-- ==========================================================

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

-- 2. BẢNG CUSTOMERS (Khách hàng)
CREATE TABLE IF NOT EXISTS customers (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(50),
    address TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- 3. BẢNG ORDERS (Đơn hàng giao nhận)
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
    order_image TEXT,
    route_id VARCHAR(100),
    completed_at_formatted VARCHAR(100),
    overtime_string VARCHAR(100),
    sync_google_status VARCHAR(20) DEFAULT 'SYNCED', -- 'PENDING', 'SYNCED', 'FAILED'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chỉ mục tối ưu truy vấn
CREATE INDEX IF NOT EXISTS idx_orders_driver_id ON orders(driver_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_route_id ON orders(route_id);

-- 4. BẢNG DRIVER_LOCATIONS (Định vị Live Tài xế)
CREATE TABLE IF NOT EXISTS driver_locations (
    driver_id VARCHAR(50) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    driver_name VARCHAR(100),
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. BẢNG SHIFT_REPORTS (Báo cáo Chốt ca / Nộp tuyến tiền COD)
CREATE TABLE IF NOT EXISTS shift_reports (
    id VARCHAR(100) PRIMARY KEY,
    driver_id VARCHAR(50),
    driver_name VARCHAR(100),
    driver_username VARCHAR(100),
    shift_name VARCHAR(150),
    total_delivered INT DEFAULT 0,
    total_order_value NUMERIC(15, 2) DEFAULT 0,
    total_cod NUMERIC(15, 2) DEFAULT 0,
    additional_fee NUMERIC(15, 2) DEFAULT 0,
    fee_note TEXT,
    fee_image TEXT,
    shift_images JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(30) DEFAULT 'PENDING', -- 'PENDING', 'CONFIRMED'
    confirmed_by VARCHAR(100),
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shift_reports_created_at ON shift_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_reports_driver_username ON shift_reports(driver_username);

-- 6. BẢNG EXPENSES (Khoản chi phát sinh kế toán)
CREATE TABLE IF NOT EXISTS expenses (
    id VARCHAR(100) PRIMARY KEY,
    note TEXT NOT NULL,
    amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    image_url TEXT,
    accountant_name VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at DESC);

-- 7. SEED DỮ LIỆU TÀI KHOẢN THEO GOOGLE SHEET THỰC TẾ
INSERT INTO users (id, username, password_hash, full_name, phone, role, status)
VALUES
    ('admin-1', 'admin', '123', 'Quản Lý Hệ Thống', '0901234567', 'MANAGER', 'ACTIVE'),
    ('KT001', 'ketoan', '123', 'Kế Toán', '0907654321', 'ACCOUNTANT', 'ACTIVE'),
    ('U177250475416', 'Lqn', '12345', 'Lê Quang Ngọc', '0912345678', 'DRIVER', 'ACTIVE'),
    ('U177250483001', 'Pdp', '12345', 'Phạm Đình Phi', '0923456789', 'DRIVER', 'ACTIVE'),
    ('U177250485058', 'Gvt', '12345', 'Giàng Văn Tuấn', '0934567890', 'DRIVER', 'ACTIVE'),
    ('U177250488602', 'Nvp', '12345', 'Nguyễn Vĩnh Phú', '0945678901', 'DRIVER', 'ACTIVE'),
    ('U177250491786', 'Ntak', '12345', 'Ngô Tùng Anh Kha', '0956789012', 'DRIVER', 'ACTIVE'),
    ('U177250493663', 'Vtd', '12345', 'Võ Thành Duy', '0967890123', 'DRIVER', 'ACTIVE')
ON CONFLICT (username) DO UPDATE SET
    id = EXCLUDED.id,
    password_hash = EXCLUDED.password_hash,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    status = 'ACTIVE',
    updated_at = NOW();

