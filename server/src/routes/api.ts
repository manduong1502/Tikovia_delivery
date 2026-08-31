import { Router } from 'express';
import { 
  orderService, 
  userService, 
  customerService, 
  shiftReportService, 
  expenseService 
} from '../services/orderService';

export const router = Router();

// ==========================================================
// 1. HEALTH CHECK
// ==========================================================
router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ==========================================================
// 2. AUTHENTICATION & USERS
// ==========================================================
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const user = await userService.login(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
    }
    res.json(user);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Database error during login' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await userService.getAllUsers();
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.get('/users/drivers', async (req, res) => {
  try {
    const drivers = await userService.getDrivers();
    res.json(drivers);
  } catch (error) {
    console.error('Get drivers error:', error);
    res.status(500).json({ error: 'Failed to fetch drivers' });
  }
});

router.post('/users/drivers', async (req, res) => {
  const { username, password, fullName, phone } = req.body;
  if (!username || !fullName) {
    return res.status(400).json({ error: 'Username and fullName are required' });
  }

  try {
    const driver = await userService.createDriver({ username, password, fullName, phone });
    res.status(201).json(driver);
  } catch (error) {
    console.error('Create driver error:', error);
    res.status(500).json({ error: 'Failed to create driver' });
  }
});

// ==========================================================
// 3. CUSTOMERS
// ==========================================================
router.get('/customers', async (req, res) => {
  try {
    const customers = await customerService.getAllCustomers();
    res.json(customers);
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

router.post('/customers', async (req, res) => {
  const { name, phone, address, location, id } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Customer name is required' });
  }

  try {
    const created = await customerService.createCustomer({ id, name, phone, address, location });
    res.status(201).json(created);
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

router.get('/customers/search', async (req, res) => {
  const q = req.query.q as string;
  if (!q) {
    return res.json([]);
  }

  try {
    const results = await customerService.searchCustomers(q);
    res.json(results);
  } catch (error) {
    console.error('Search customers error:', error);
    res.status(500).json({ error: 'Failed to search customers' });
  }
});

// ==========================================================
// 4. ORDERS
// ==========================================================
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
  const { status, podImageUrl, podSignature, note, codAmount, completedAtFormatted, overtimeString } = req.body;
  try {
    const updated = await orderService.updateStatus(id, status, { 
      podImageUrl, 
      podSignature, 
      note, 
      codAmount,
      completedAtFormatted,
      overtimeString 
    });
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

// ==========================================================
// 5. GPS TRACKING
// ==========================================================
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

// ==========================================================
// 6. SHIFT REPORTS (Chốt ca / Nộp tiền)
// ==========================================================
router.get('/shifts', async (req, res) => {
  try {
    const reports = await shiftReportService.getAllShiftReports();
    res.json(reports);
  } catch (error) {
    console.error('Get shift reports error:', error);
    res.status(500).json({ error: 'Failed to fetch shift reports' });
  }
});

router.post('/shifts', async (req, res) => {
  try {
    const report = await shiftReportService.createShiftReport(req.body);
    res.status(201).json(report);
  } catch (error) {
    console.error('Create shift report error:', error);
    res.status(500).json({ error: 'Failed to create shift report' });
  }
});

router.post('/shifts/confirm', async (req, res) => {
  const { reportId, confirmedBy } = req.body;
  if (!reportId) {
    return res.status(400).json({ error: 'reportId is required' });
  }

  try {
    const confirmed = await shiftReportService.confirmShiftReport(reportId, confirmedBy || 'Kế Toán');
    res.json(confirmed);
  } catch (error) {
    console.error('Confirm shift report error:', error);
    res.status(500).json({ error: 'Failed to confirm shift report' });
  }
});

// ==========================================================
// 7. EXPENSES (Quản lý chi phí kế toán)
// ==========================================================
router.get('/expenses', async (req, res) => {
  try {
    const expenses = await expenseService.getAllExpenses();
    res.json(expenses);
  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

router.post('/expenses', async (req, res) => {
  const { expenses, accountantName } = req.body;
  if (!Array.isArray(expenses)) {
    return res.status(400).json({ error: 'expenses must be an array' });
  }

  try {
    const result = await expenseService.saveExpenses(expenses, accountantName || 'Kế Toán');
    res.json(result);
  } catch (error) {
    console.error('Save expenses error:', error);
    res.status(500).json({ error: 'Failed to save expenses' });
  }
});

