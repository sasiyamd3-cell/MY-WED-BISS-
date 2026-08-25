const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================
// ============ FILE-BASED DATABASE (JSON) ====================
// ============================================================

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Read data from JSON file
function readData(filename) {
  const filePath = path.join(DATA_DIR, filename + '.json');
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([]));
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(filePath));
  } catch {
    return [];
  }
}

// Write data to JSON file
function writeData(filename, data) {
  const filePath = path.join(DATA_DIR, filename + '.json');
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ========== USERS ==========
function getUsers() { return readData('users'); }
function saveUsers(users) { writeData('users', users); }
function findUserByEmail(email) {
  return getUsers().find(u => u.email === email);
}
function findUserById(id) {
  return getUsers().find(u => u.id === id);
}

// ========== ORDERS ==========
function getOrders() { return readData('orders'); }
function saveOrders(orders) { writeData('orders', orders); }
function getOrdersByClient(clientId) {
  return getOrders().filter(o => o.client === clientId).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ============================================================
// ============ CREATE ADMIN USER (if not exists) =============
// ============================================================
(async () => {
  const users = getUsers();
  const adminExists = users.find(u => u.email === 'admin@webdesign.com');
  if (!adminExists) {
    const hashedPwd = await bcrypt.hash('admin123', 10);
    users.push({
      id: 'admin_' + Date.now(),
      name: 'Admin',
      email: 'admin@webdesign.com',
      password: hashedPwd,
      phone: '0712345678',
      role: 'admin',
      createdAt: new Date().toISOString()
    });
    saveUsers(users);
    console.log('👑 Admin created: admin@webdesign.com / admin123');
  }
})();

// ============================================================
// ============ MIDDLEWARE ====================================
// ============================================================
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) throw new Error('No token');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secretkey');
    const user = findUserById(decoded.id);
    if (!user) throw new Error('User not found');
    const { password, ...safeUser } = user;
    req.user = safeUser;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Please authenticate' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. Admin only.' });
  }
  next();
};

// ============================================================
// ============ AUTH ROUTES ===================================
// ============================================================

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    
    const users = getUsers();
    if (users.find(u => u.email === email)) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      name,
      email,
      password: hashedPassword,
      phone: phone || '',
      role: 'client',
      createdAt: new Date().toISOString()
    };
    
    users.push(newUser);
    saveUsers(users);

    const token = jwt.sign(
      { id: newUser.id },
      process.env.JWT_SECRET || 'secretkey',
      { expiresIn: '7d' }
    );

    const { password: _, ...userWithoutPwd } = newUser;
    res.status(201).json({ token, user: userWithoutPwd });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET || 'secretkey',
      { expiresIn: '7d' }
    );

    const { password: _, ...userWithoutPwd } = user;
    res.json({ token, user: userWithoutPwd });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET CURRENT USER
app.get('/api/auth/me', auth, (req, res) => {
  res.json(req.user);
});

// ============================================================
// ============ ORDER ROUTES ==================================
// ============================================================

// CREATE ORDER
app.post('/api/orders', auth, async (req, res) => {
  try {
    const orders = getOrders();
    const newOrder = {
      _id: 'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      client: req.user.id,
      clientName: req.body.clientName || req.user.name,
      email: req.body.email || req.user.email,
      phone: req.body.phone || '',
      projectType: req.body.projectType || 'website',
      description: req.body.description || '',
      budget: req.body.budget || 0,
      features: req.body.features || [],
      deadline: req.body.deadline || null,
      status: 'pending',
      price: null,
      createdAt: new Date().toISOString()
    };
    orders.push(newOrder);
    saveOrders(orders);
    res.status(201).json(newOrder);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET MY ORDERS
app.get('/api/orders/my-orders', auth, (req, res) => {
  try {
    const orders = getOrdersByClient(req.user.id);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET ALL ORDERS (ADMIN ONLY)
app.get('/api/orders/all', auth, adminOnly, (req, res) => {
  try {
    const orders = getOrders().sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    // Add user details to each order
    const users = getUsers();
    const ordersWithUsers = orders.map(o => {
      const user = users.find(u => u.id === o.client);
      return { ...o, clientDetails: user ? { name: user.name, email: user.email } : null };
    });
    res.json(ordersWithUsers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// UPDATE ORDER (ADMIN ONLY)
app.put('/api/orders/:id', auth, adminOnly, (req, res) => {
  try {
    const orders = getOrders();
    const index = orders.findIndex(o => o._id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ message: 'Order not found' });
    }
    orders[index] = { ...orders[index], ...req.body };
    saveOrders(orders);
    res.json(orders[index]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE ORDER (ADMIN ONLY)
app.delete('/api/orders/:id', auth, adminOnly, (req, res) => {
  try {
    let orders = getOrders();
    orders = orders.filter(o => o._id !== req.params.id);
    saveOrders(orders);
    res.json({ message: 'Order deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ============================================================
// ============ SERVE STATIC FILES ============================
// ============================================================
app.use(express.static(__dirname));

// Serve index.html as default
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// ============ START SERVER ==================================
// ============================================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Data stored in: ${DATA_DIR}`);
  console.log(`👑 Admin: admin@webdesign.com / admin123`);
});
