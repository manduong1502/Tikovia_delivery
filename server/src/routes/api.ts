import { Router } from 'express';
import { query } from '../config/db';
import { orderService } from '../services/orderService';

export const router = Router();

// --- 1. HEALTH CHECK ---
router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// --- 2. AUTHENTICATION & USERS ---
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const result = await query(
      'SELECT id, username, full_name, phone, role, status FROM users WHERE LOWER(username) = LOWER($1) AND password_hash = $2 AND status = $3',
      [username.trim(), password.trim(), 'ACTIVE']
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      phone: user.phone,
      role: user.role
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Database error during login' });
  }
});

router.get('/users/drivers', async (req, res) => {
  try {
    const result = await query(
      "SELECT id, username, full_name, phone, role FROM users WHERE role = 'DRIVER' AND status = 'ACTIVE' ORDER BY full_name ASC"
    );
    res.json(result.rows.map(u => ({
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      phone: u.phone,
      role: u.role
    })));
  } catch (error) {
    console.error('Get drivers error:', error);
    res.status(500).json({ error: 'Failed to fetch drivers' });
  }
});

// --- 3. ORDERS API ---
router.get('/orders', async (req, res) => {
  const driverId = req.query.driverId as string;
  try {
    if (driverId) {
      const orders = await orderService.getOrdersByDriver(driverId);
      res.json(orders);
    } else {
      const orders = await orderService.getAllOrders();
      res.json(orders);
    }
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

router.post('/orders', async (req, res) => {
  try {
    const created = await orderService.createOrder(req.body);
    res.status(201).json(created);
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

router.put('/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, podImageUrl, podSignature, note, codAmount } = req.body;
  try {
    const updated = await orderService.updateStatus(id, status, { podImageUrl, podSignature, note, codAmount });
    res.json(updated);
  } catch (error: any) {
    console.error('Update status error:', error);
    res.status(500).json({ error: error.message || 'Failed to update order status' });
  }
});

router.put('/orders/:id/assign', async (req, res) => {
  const { id } = req.params;
  const { driverId, driverName } = req.body;
  try {
    const updated = await orderService.assignDriver(id, driverId, driverName);
    res.json(updated);
  } catch (error: any) {
    console.error('Assign driver error:', error);
    res.status(500).json({ error: error.message || 'Failed to assign driver' });
  }
});

router.delete('/orders/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await orderService.deleteOrder(id);
    res.json(result);
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

// --- 4. GPS TRACKING ---
router.post('/tracking/location', async (req, res) => {
  const { driverId, driverName, lat, lng } = req.body;
  if (!driverId || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'driverId, lat, and lng are required' });
  }

  try {
    const result = await orderService.updateDriverLocation(driverId, driverName || '', lat, lng);
    res.json(result);
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

router.get('/tracking/drivers', async (req, res) => {
  try {
    const locations = await orderService.getDriverLocations();
    res.json(locations);
  } catch (error) {
    console.error('Get locations error:', error);
    res.status(500).json({ error: 'Failed to fetch driver locations' });
  }
});

// --- 5. COD SETTLEMENTS ---
router.post('/cod/settle', async (req, res) => {
  try {
    const result = await orderService.recordCodSettlement(req.body);
    res.json(result);
  } catch (error) {
    console.error('COD settlement error:', error);
    res.status(500).json({ error: 'Failed to settle COD shift' });
  }
});

router.get('/cod/history', async (req, res) => {
  try {
    const result = await query('SELECT * FROM cod_settlements ORDER BY created_at DESC LIMIT 100');
    res.json(result.rows);
  } catch (error) {
    console.error('Get COD history error:', error);
    res.status(500).json({ error: 'Failed to fetch COD history' });
  }
});
