import { query } from '../config/db';
import { syncToGoogleSheetAsync } from './googleSyncService';

// ==========================================================
// 1. ORDERS SERVICE
// ==========================================================

export const mapOrderToFrontend = (row: any) => ({
  id: row.id,
  customerName: row.customer_name || '',
  customerPhone: row.customer_phone || '',
  address: row.address || '',
  lat: row.lat !== null && row.lat !== undefined ? parseFloat(row.lat) : undefined,
  lng: row.lng !== null && row.lng !== undefined ? parseFloat(row.lng) : undefined,
  location: (row.lat !== null && row.lng !== null && row.lat !== undefined && row.lng !== undefined) 
    ? { lat: parseFloat(row.lat), lng: parseFloat(row.lng) } 
    : { lat: 10.762622, lng: 106.660172 },
  codAmount: parseFloat(row.cod_amount || 0),
  orderValue: parseFloat(row.total_amount || row.cod_amount || 0),
  shippingFee: parseFloat(row.shipping_fee || 0),
  totalAmount: parseFloat(row.total_amount || 0),
  itemsSummary: row.items_summary || '',
  items: row.items_summary ? String(row.items_summary).split(',').map((s: string) => s.trim()).filter(Boolean) : [],
  itemsDetail: row.items_detail || [],
  note: row.note || '',
  status: row.status,
  driverId: row.driver_id || undefined,
  driverName: row.driver_name || undefined,
  podImageUrl: row.pod_image_url || undefined,
  proofOfDelivery: row.pod_image_url ? {
    imageUrl: row.pod_image_url,
    timestamp: new Date(row.updated_at || row.created_at).getTime(),
    location: { lat: parseFloat(row.lat || 0), lng: parseFloat(row.lng || 0) }
  } : undefined,
  podSignature: row.pod_signature || undefined,
  orderImage: row.order_image || undefined,
  routeId: row.route_id || '',
  completedAtFormatted: row.completed_at_formatted || '',
  overtimeString: row.overtime_string || '',
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
    const lat = orderData.location?.lat ?? orderData.lat ?? null;
    const lng = orderData.location?.lng ?? orderData.lng ?? null;
    const codAmount = orderData.codAmount ?? orderData.orderValue ?? orderData.cod_amount ?? 0;
    const shippingFee = orderData.shippingFee ?? orderData.shipping_fee ?? 0;
    const totalAmount = orderData.totalAmount ?? orderData.orderValue ?? orderData.total_amount ?? (Number(codAmount) + Number(shippingFee));
    const itemsSummary = orderData.itemsString || orderData.itemsSummary || orderData.items_summary || (Array.isArray(orderData.items) ? orderData.items.join(', ') : '');
    const itemsDetail = JSON.stringify(orderData.itemsDetail || orderData.items_detail || []);
    const note = orderData.note || '';
    const status = orderData.status || 'ASSIGNED';
    const driverId = orderData.driverId || orderData.driver_id || null;
    const driverName = orderData.driverName || orderData.driver_name || null;
    const orderImage = orderData.orderImage || orderData.order_image || null;
    const routeId = orderData.routeId || orderData.route_id || '';
    const completedAtFormatted = orderData.completedAtFormatted || orderData.completed_at_formatted || '';
    const overtimeString = orderData.overtimeString || orderData.overtime_string || '';

    const res = await query(`
      INSERT INTO orders (
        id, customer_name, customer_phone, address, lat, lng, 
        cod_amount, shipping_fee, total_amount, items_summary, items_detail, 
        note, status, driver_id, driver_name, order_image, route_id,
        completed_at_formatted, overtime_string, sync_google_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 'SYNCED')
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
        order_image = EXCLUDED.order_image,
        route_id = EXCLUDED.route_id,
        completed_at_formatted = EXCLUDED.completed_at_formatted,
        overtime_string = EXCLUDED.overtime_string,
        updated_at = NOW()
      RETURNING *
    `, [id, customerName, customerPhone, address, lat, lng, codAmount, shippingFee, totalAmount, itemsSummary, itemsDetail, note, status, driverId, driverName, orderImage, routeId, completedAtFormatted, overtimeString]);

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
      driverName,
      routeId,
      orderImage
    });

    return created;
  },

  async updateStatus(id: string, status: string, podData?: { 
    podImageUrl?: string; 
    podSignature?: string; 
    note?: string; 
    codAmount?: number;
    completedAtFormatted?: string;
    overtimeString?: string;
    driverId?: string;
    driverName?: string;
  }) {
    const fields: string[] = ['status = $2', 'updated_at = NOW()'];
    const values: any[] = [id, status];
    let idx = 3;

    if (podData?.driverId) {
      fields.push(`driver_id = $${idx++}`);
      values.push(podData.driverId);
    }
    if (podData?.driverName) {
      fields.push(`driver_name = $${idx++}`);
      values.push(podData.driverName);
    }
    if (podData?.podImageUrl) {
      fields.push(`pod_image_url = $${idx++}`);
      values.push(podData.podImageUrl);
    }
    if (podData?.podSignature) {
      fields.push(`pod_signature = $${idx++}`);
      values.push(podData.podSignature);
    }
    if (podData?.note !== undefined) {
      fields.push(`note = $${idx++}`);
      values.push(podData.note);
    }
    if (podData?.codAmount !== undefined) {
      fields.push(`cod_amount = $${idx++}`);
      values.push(podData.codAmount);
    }
    if (podData?.completedAtFormatted) {
      fields.push(`completed_at_formatted = $${idx++}`);
      values.push(podData.completedAtFormatted);
    }
    if (podData?.overtimeString) {
      fields.push(`overtime_string = $${idx++}`);
      values.push(podData.overtimeString);
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
      note: podData?.note,
      codAmount: podData?.codAmount,
      completedAtFormatted: podData?.completedAtFormatted,
      overtimeString: podData?.overtimeString
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
  }
};

// ==========================================================
// 2. USERS SERVICE (Quản lý tài khoản)
// ==========================================================

export const userService = {
  async login(username: string, password: string) {
    const result = await query(
      'SELECT id, username, full_name, phone, role, status FROM users WHERE LOWER(username) = LOWER($1) AND password_hash = $2 AND status = $3',
      [username.trim(), password.trim(), 'ACTIVE']
    );

    if (result.rows.length === 0) {
      return null;
    }

    const u = result.rows[0];
    return {
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      phone: u.phone,
      role: u.role
    };
  },

  async getAllUsers() {
    const res = await query("SELECT id, username, full_name, phone, role, status FROM users WHERE status = 'ACTIVE' ORDER BY full_name ASC");
    return res.rows.map(u => ({
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      phone: u.phone,
      role: u.role
    }));
  },

  async getDrivers() {
    const res = await query("SELECT id, username, full_name, phone, role FROM users WHERE role = 'DRIVER' AND status = 'ACTIVE' ORDER BY full_name ASC");
    return res.rows.map(u => ({
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      phone: u.phone,
      role: u.role
    }));
  },

  async createDriver(data: { username: string; password?: string; fullName: string; phone?: string }) {
    const id = `U${Date.now()}`;
    const password = data.password || '12345';
    const res = await query(`
      INSERT INTO users (id, username, password_hash, full_name, phone, role, status)
      VALUES ($1, $2, $3, $4, $5, 'DRIVER', 'ACTIVE')
      ON CONFLICT (username) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        status = 'ACTIVE',
        updated_at = NOW()
      RETURNING id, username, full_name, phone, role
    `, [id, data.username.trim(), password.trim(), data.fullName.trim(), data.phone || '']);

    const user = {
      id: res.rows[0].id,
      username: res.rows[0].username,
      fullName: res.rows[0].full_name,
      phone: res.rows[0].phone,
      role: res.rows[0].role
    };

    // Dual-sync to Google Sheet
    syncToGoogleSheetAsync('saveUser', {
      username: data.username,
      password: password,
      fullName: data.fullName,
      role: 'DRIVER'
    });

    return user;
  }
};

// ==========================================================
// 3. CUSTOMERS SERVICE (Quản lý khách hàng)
// ==========================================================

export const customerService = {
  async getAllCustomers() {
    const res = await query('SELECT * FROM customers ORDER BY name ASC');
    return res.rows.map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone || '',
      address: c.address || '',
      location: (c.lat && c.lng) ? { lat: parseFloat(c.lat), lng: parseFloat(c.lng) } : undefined
    }));
  },

  async createCustomer(data: { id?: string; name: string; phone: string; address: string; location?: { lat: number; lng: number } }) {
    const id = data.id || `CUST-${Date.now()}`;
    const lat = data.location?.lat || null;
    const lng = data.location?.lng || null;

    const res = await query(`
      INSERT INTO customers (id, name, phone, address, lat, lng)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        updated_at = NOW()
      RETURNING *
    `, [id, data.name, String(data.phone || ''), data.address, lat, lng]);

    const created = {
      id: res.rows[0].id,
      name: res.rows[0].name,
      phone: res.rows[0].phone,
      address: res.rows[0].address,
      location: (res.rows[0].lat && res.rows[0].lng) ? { lat: parseFloat(res.rows[0].lat), lng: parseFloat(res.rows[0].lng) } : undefined
    };

    // Dual-sync to Google Sheet
    syncToGoogleSheetAsync('saveCustomer', {
      id: created.id,
      name: created.name,
      phone: created.phone,
      address: created.address,
      location: created.location
    });

    return created;
  },

  async searchCustomers(q: string) {
    const term = `%${q.toLowerCase().trim()}%`;
    const res = await query(`
      SELECT * FROM customers 
      WHERE LOWER(name) LIKE $1 OR phone LIKE $1 
      ORDER BY name ASC 
      LIMIT 20
    `, [term]);
    return res.rows.map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone || '',
      address: c.address || '',
      location: (c.lat && c.lng) ? { lat: parseFloat(c.lat), lng: parseFloat(c.lng) } : undefined
    }));
  }
};

// ==========================================================
// 4. SHIFT REPORTS SERVICE (Chốt ca / Nộp tiền)
// ==========================================================

export const shiftReportService = {
  async getAllShiftReports() {
    const res = await query(`
      SELECT * FROM shift_reports 
      ORDER BY created_at DESC 
      LIMIT 100
    `);
    return res.rows.map(r => ({
      id: r.id,
      driverId: r.driver_id,
      driverName: r.driver_name,
      driverUsername: r.driver_username,
      shiftName: r.shift_name,
      totalDelivered: parseInt(r.total_delivered || 0, 10),
      totalOrderValue: parseFloat(r.total_order_value || 0),
      totalCOD: parseFloat(r.total_cod || 0),
      additionalFee: parseFloat(r.additional_fee || 0),
      feeNote: r.fee_note || '',
      feeImage: r.fee_image || '',
      shiftImages: r.shift_images || [],
      status: r.status,
      confirmedBy: r.confirmed_by,
      confirmedAt: r.confirmed_at,
      timestamp: r.created_at ? new Date(r.created_at).toLocaleString('vi-VN') : '',
      createdAt: r.created_at
    }));
  },

  async createShiftReport(data: {
    driverName: string;
    driverUsername: string;
    shiftName: string;
    totalDelivered: number;
    totalOrderValue: number;
    totalCOD: number;
    additionalFee?: number;
    feeNote?: string;
    feeImage?: string;
    shiftImages?: string[];
  }) {
    const id = `SHIFT-${Date.now()}`;
    const res = await query(`
      INSERT INTO shift_reports (
        id, driver_name, driver_username, shift_name,
        total_delivered, total_order_value, total_cod,
        additional_fee, fee_note, fee_image, shift_images, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING')
      RETURNING *
    `, [
      id,
      data.driverName,
      data.driverUsername,
      data.shiftName,
      data.totalDelivered || 0,
      data.totalOrderValue || 0,
      data.totalCOD || 0,
      data.additionalFee || 0,
      data.feeNote || '',
      data.feeImage || '',
      JSON.stringify(data.shiftImages || [])
    ]);

    // Dual-sync to Google Sheet
    syncToGoogleSheetAsync('saveShiftReport', {
      ...data,
      id,
      timestamp: new Date().toLocaleString('vi-VN')
    });

    return res.rows[0];
  },

  async confirmShiftReport(reportId: string, confirmedBy: string) {
    const res = await query(`
      UPDATE shift_reports 
      SET status = 'CONFIRMED', confirmed_by = $2, confirmed_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [reportId, confirmedBy]);

    // Dual-sync to Google Sheet
    syncToGoogleSheetAsync('confirmShiftReport', { reportId });

    return res.rows[0];
  }
};

// ==========================================================
// 5. EXPENSES SERVICE (Quản lý chi phí kế toán)
// ==========================================================

export const expenseService = {
  async getAllExpenses() {
    const res = await query('SELECT * FROM expenses ORDER BY created_at DESC LIMIT 200');
    return res.rows.map(e => ({
      id: e.id,
      note: e.note,
      amount: parseFloat(e.amount || 0),
      image: e.image_url || '',
      accountantName: e.accountant_name || '',
      timestamp: e.created_at ? new Date(e.created_at).toLocaleString('vi-VN') : '',
      createdAt: e.created_at
    }));
  },

  async saveExpenses(expenses: Array<{ id?: string; note: string; amount: number | string; image?: string }>, accountantName: string) {
    const results = [];
    for (const exp of expenses) {
      if (!exp.note || !exp.amount) continue;
      const id = exp.id || `EXP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const amount = parseFloat(String(exp.amount).replace(/\D/g, '')) || 0;
      const res = await query(`
        INSERT INTO expenses (id, note, amount, image_url, accountant_name)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          note = EXCLUDED.note,
          amount = EXCLUDED.amount,
          image_url = EXCLUDED.image_url,
          accountant_name = EXCLUDED.accountant_name
        RETURNING *
      `, [id, exp.note, amount, exp.image || '', accountantName]);
      results.push(res.rows[0]);
    }

    // Dual-sync to Google Sheet
    syncToGoogleSheetAsync('saveExpenses', { expenses, accountantName });

    return { status: 'success', count: results.length };
  }
};

