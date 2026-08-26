import { query } from '../config/db';
import { syncToGoogleSheetAsync } from './googleSyncService';

export interface DbOrder {
  id: string;
  customer_name: string;
  customer_phone: string;
  address: string;
  lat: number | null;
  lng: number | null;
  cod_amount: number;
  shipping_fee: number;
  total_amount: number;
  items_summary: string;
  items_detail: any;
  note: string;
  status: string;
  driver_id: string | null;
  driver_name: string | null;
  pod_image_url: string | null;
  pod_signature: string | null;
  sync_google_status: string;
  created_at: string;
  updated_at: string;
}

// Convert DB format (snake_case) to Frontend model (camelCase)
export const mapOrderToFrontend = (row: any) => ({
  id: row.id,
  customerName: row.customer_name || '',
  customerPhone: row.customer_phone || '',
  address: row.address || '',
  lat: row.lat !== null ? parseFloat(row.lat) : undefined,
  lng: row.lng !== null ? parseFloat(row.lng) : undefined,
  codAmount: parseFloat(row.cod_amount || 0),
  shippingFee: parseFloat(row.shipping_fee || 0),
  totalAmount: parseFloat(row.total_amount || 0),
  itemsSummary: row.items_summary || '',
  itemsDetail: row.items_detail || [],
  note: row.note || '',
  status: row.status,
  driverId: row.driver_id || undefined,
  driverName: row.driver_name || undefined,
  podImageUrl: row.pod_image_url || undefined,
  podSignature: row.pod_signature || undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const orderService = {
  async getAllOrders() {
    const res = await query(`
      SELECT * FROM orders 
      ORDER BY created_at DESC 
      LIMIT 500
    `);
    return res.rows.map(mapOrderToFrontend);
  },

  async getOrdersByDriver(driverId: string) {
    const res = await query(`
      SELECT * FROM orders 
      WHERE driver_id = $1 OR driver_id IS NULL OR status = 'ASSIGNED'
      ORDER BY created_at DESC 
      LIMIT 200
    `, [driverId]);
    return res.rows.map(mapOrderToFrontend);
  },

  async createOrder(orderData: any) {
    const id = orderData.id || `DH-${Date.now()}`;
    const customerName = orderData.customerName || orderData.customer_name || '';
    const customerPhone = orderData.customerPhone || orderData.customer_phone || '';
    const address = orderData.address || '';
    const lat = orderData.lat || null;
    const lng = orderData.lng || null;
    const codAmount = orderData.codAmount ?? orderData.cod_amount ?? 0;
    const shippingFee = orderData.shippingFee ?? orderData.shipping_fee ?? 0;
    const totalAmount = orderData.totalAmount ?? orderData.total_amount ?? (Number(codAmount) + Number(shippingFee));
    const itemsSummary = orderData.itemsSummary || orderData.items_summary || (typeof orderData.items === 'string' ? orderData.items : '');
    const itemsDetail = JSON.stringify(orderData.itemsDetail || orderData.items_detail || []);
    const note = orderData.note || '';
    const status = orderData.status || 'ASSIGNED';
    const driverId = orderData.driverId || orderData.driver_id || null;
    const driverName = orderData.driverName || orderData.driver_name || null;

    const res = await query(`
      INSERT INTO orders (
        id, customer_name, customer_phone, address, lat, lng, 
        cod_amount, shipping_fee, total_amount, items_summary, items_detail, 
        note, status, driver_id, driver_name, sync_google_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'SYNCED')
      ON CONFLICT (id) DO UPDATE SET
        customer_name = EXCLUDED.customer_name,
        customer_phone = EXCLUDED.customer_phone,
        address = EXCLUDED.address,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        cod_amount = EXCLUDED.cod_amount,
        shipping_fee = EXCLUDED.shipping_fee,
        total_amount = EXCLUDED.total_amount,
        items_summary = EXCLUDED.items_summary,
        items_detail = EXCLUDED.items_detail,
        note = EXCLUDED.note,
        status = EXCLUDED.status,
        driver_id = EXCLUDED.driver_id,
        driver_name = EXCLUDED.driver_name,
        updated_at = NOW()
      RETURNING *
    `, [id, customerName, customerPhone, address, lat, lng, codAmount, shippingFee, totalAmount, itemsSummary, itemsDetail, note, status, driverId, driverName]);

    const created = mapOrderToFrontend(res.rows[0]);

    // Dual-sync to Google Sheet in background
    syncToGoogleSheetAsync('createOrder', {
      id,
      customerName,
      customerPhone,
      address,
      lat,
      lng,
      codAmount,
      shippingFee,
      totalAmount,
      items: itemsSummary,
      note,
      status,
      driverId,
      driverName
    });

    return created;
  },

  async updateStatus(id: string, status: string, podData?: { podImageUrl?: string; podSignature?: string; note?: string; codAmount?: number }) {
    const fields: string[] = ['status = $2', 'updated_at = NOW()'];
    const values: any[] = [id, status];
    let idx = 3;

    if (podData?.podImageUrl) {
      fields.push(`pod_image_url = $${idx++}`);
      values.push(podData.podImageUrl);
    }
    if (podData?.podSignature) {
      fields.push(`pod_signature = $${idx++}`);
      values.push(podData.podSignature);
    }
    if (podData?.note) {
      fields.push(`note = $${idx++}`);
      values.push(podData.note);
    }
    if (podData?.codAmount !== undefined) {
      fields.push(`cod_amount = $${idx++}`);
      values.push(podData.codAmount);
    }

    const res = await query(`
      UPDATE orders 
      SET ${fields.join(', ')}
      WHERE id = $1
      RETURNING *
    `, values);

    if (res.rowCount === 0) {
      throw new Error(`Order ${id} not found`);
    }

    const updated = mapOrderToFrontend(res.rows[0]);

    // Dual-sync to Google Sheet in background
    syncToGoogleSheetAsync('updateOrderStatus', {
      id,
      status,
      podImageUrl: podData?.podImageUrl,
      podSignature: podData?.podSignature,
      note: podData?.note
    });

    return updated;
  },

  async assignDriver(id: string, driverId: string, driverName: string) {
    const res = await query(`
      UPDATE orders 
      SET driver_id = $2, driver_name = $3, status = 'ASSIGNED', updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id, driverId, driverName]);

    if (res.rowCount === 0) {
      throw new Error(`Order ${id} not found`);
    }

    const updated = mapOrderToFrontend(res.rows[0]);

    // Dual-sync to Google Sheet
    syncToGoogleSheetAsync('assignDriver', { id, driverId, driverName });

    return updated;
  },

  async deleteOrder(id: string) {
    await query('DELETE FROM orders WHERE id = $1', [id]);
    syncToGoogleSheetAsync('deleteOrder', { id });
    return { success: true, id };
  },

  async updateDriverLocation(driverId: string, driverName: string, lat: number, lng: number) {
    await query(`
      INSERT INTO driver_locations (driver_id, driver_name, lat, lng, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (driver_id) DO UPDATE SET
        driver_name = EXCLUDED.driver_name,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        updated_at = NOW()
    `, [driverId, driverName, lat, lng]);
    return { success: true, driverId, lat, lng };
  },

  async getDriverLocations() {
    const res = await query(`
      SELECT dl.*, u.phone 
      FROM driver_locations dl
      LEFT JOIN users u ON dl.driver_id = u.id
      WHERE dl.updated_at >= NOW() - INTERVAL '12 hours'
      ORDER BY dl.updated_at DESC
    `);
    return res.rows.map(r => ({
      driverId: r.driver_id,
      driverName: r.driver_name,
      phone: r.phone,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lng),
      updatedAt: r.updated_at
    }));
  },

  async recordCodSettlement(data: { driverId: string; driverName: string; shiftDate: string; totalCodCollected: number; totalOrdersCompleted: number; approvedBy?: string }) {
    const id = `SETTLE-${Date.now()}`;
    const res = await query(`
      INSERT INTO cod_settlements (id, driver_id, driver_name, shift_date, total_cod_collected, total_orders_completed, status, approved_by)
      VALUES ($1, $2, $3, $4, $5, $6, 'APPROVED', $7)
      RETURNING *
    `, [id, data.driverId, data.driverName, data.shiftDate, data.totalCodCollected, data.totalOrdersCompleted, data.approvedBy || 'Quản Lý']);

    syncToGoogleSheetAsync('settleCodShift', data);
    return res.rows[0];
  }
};
