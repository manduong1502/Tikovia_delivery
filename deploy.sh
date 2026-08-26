#!/bin/bash
# ==============================================================================
# TIKOVIA DELIVERY - AUTO DEPLOY SCRIPT TRÊN VPS / MINI SERVER UBUNTU
# Thư mục triển khai: /mnt/ssd500/tiko/tikovia-delivery (hoặc ~/tikovia-delivery)
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

echo "=========================================="
echo "🚀 1. CẬP NHẬT SOURCE CODE TỪ GITHUB"
echo "=========================================="
sudo git config --global --add safe.directory "$DIR" || true
sudo git fetch --all
sudo git reset --hard origin/main

echo "=========================================="
echo "🗄️ 2. KHỞI TẠO / CẬP NHẬT DATABASE POSTGRESQL"
echo "=========================================="
# Tạo database tikovia_delivery nếu chưa có trên container tiko-bizpos-db
sudo docker exec -i tiko-bizpos-db psql -U tikovia -d bizpos -tc "SELECT 1 FROM pg_database WHERE datname = 'tikovia_delivery'" | grep -q 1 || \
sudo docker exec -i tiko-bizpos-db psql -U tikovia -d bizpos -c "CREATE DATABASE tikovia_delivery;"

# Nạp bảng và dữ liệu mẫu từ schema.sql
sudo docker exec -i tiko-bizpos-db psql -U tikovia -d tikovia_delivery < server/schema.sql

echo "=========================================="
echo "📦 3. BUILD & KHỞI CHẠY DOCKER CONTAINERS"
echo "=========================================="
# Dọn dẹp container cũ nếu bị kẹt
sudo docker rm -f tiko-delivery-web tiko-delivery-api 2>/dev/null || true

# Khởi chạy 2 service Frontend (4002) và Backend API (4003)
sudo docker compose up -d --build

echo "=========================================="
echo "✅ DEPLOY HOÀN TẤT THÀNH CÔNG!"
echo "=========================================="
sudo docker ps | grep tiko-delivery
