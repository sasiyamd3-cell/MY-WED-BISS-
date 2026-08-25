const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const app = express();
app.use(cors({
    origin: ['http://localhost:5000', 'http://localhost:3000', 'http://127.0.0.1:5000'],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// ============================================================
// ============ MONGODB CONNECTION ============================
// ============================================================

console.log('🔗 Connecting to MongoDB...');
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => {
    console.log('✅ MongoDB Connected Successfully!');
    console.log('📦 Database:', mongoose.connection.db.databaseName);
})
.catch(err => {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1);
});

// ============================================================
// ============ MULTER (File Upload) ==========================
// ============================================================

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + '_' + Math.random().toString(36).slice(2,6) + ext);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Only images allowed'));
    }
});

// ============================================================
// ============ MODELS ========================================
// ============================================================

// User Model
const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    googleId: { type: String },
    phone: { type: String, default: '' },
    company: { type: String, default: '' },
    role: { type: String, enum: ['client', 'admin'], default: 'client' },
    avatar: { type: String, default: '' },
    isVerified: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

UserSchema.pre('save', async function(next) {
    if (!this.isModified('password') || !this.password) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

UserSchema.methods.comparePassword = async function(password) {
    if (!this.password) return false;
    return await bcrypt.compare(password, this.password);
};

const User = mongoose.model('User', UserSchema);

// Order Model
const OrderSchema = new mongoose.Schema({
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    orderNumber: { type: String, unique: true },
    clientName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, default: '' },
    company: { type: String, default: '' },
    projectType: { 
        type: String, 
        enum: ['website', 'ecommerce', 'uiux', 'mobile', 'dashboard', 'saas', 'custom'],
        default: 'website'
    },
    description: { type: String, required: true },
    budget: { type: Number, default: 0 },
    features: { type: [String], default: [] },
    deadline: { type: Date },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    status: { 
        type: String, 
        enum: ['pending', 'review', 'in-progress', 'completed', 'cancelled', 'on-hold'],
        default: 'pending'
    },
    price: { type: Number, default: 0 },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timeline: [{
        action: String,
        date: { type: Date, default: Date.now },
        by: String
    }],
    notes: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

// Auto-generate order number
OrderSchema.pre('save', function(next) {
    if (!this.orderNumber) {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const random = Math.random().toString(36).slice(2, 6).toUpperCase();
        this.orderNumber = `ORD-${year}${month}${day}-${random}`;
    }
    next();
});

const Order = mongoose.model('Order', OrderSchema);

// Project Model
const ProjectSchema = new mongoose.Schema({
    title: { type: String, required: true },
    category: { type: String, default: 'website' },
    description: { type: String, required: true },
    image: { type: String, default: '' },
    link: { type: String, default: '' },
    featured: { type: Boolean, default: false },
    technologies: { type: [String], default: [] },
    client: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

const Project = mongoose.model('Project', ProjectSchema);

// Testimonial Model
const TestimonialSchema = new mongoose.Schema({
    clientName: { type: String, required: true },
    company: { type: String, default: '' },
    content: { type: String, required: true },
    rating: { type: Number, min: 1, max: 5, default: 5 },
    avatar: { type: String, default: '' },
    position: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

const Testimonial = mongoose.model('Testimonial', TestimonialSchema);

// Message Model
const MessageSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, default: '' },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ['unread', 'read', 'replied'], default: 'unread' },
    repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    replyMessage: { type: String, default: '' },
    repliedAt: { type: Date },
    createdAt: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', MessageSchema);

// Activity Log Model
const ActivityLogSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    details: { type: Object, default: {} },
    createdAt: { type: Date, default: Date.now }
});

const ActivityLog = mongoose.model('ActivityLog', ActivityLogSchema);

// ============================================================
// ============ GOOGLE OAUTH ==================================
// ============================================================

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.post('/api/auth/google', async (req, res) => {
    try {
        const { token: googleToken } = req.body;
        const ticket = await googleClient.verifyIdToken({
            idToken: googleToken,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        const { email, name, picture, sub: googleId } = payload;

        let user = await User.findOne({ $or: [{ email }, { googleId }] });

        if (!user) {
            user = new User({
                name,
                email,
                googleId,
                avatar: picture || '',
                isVerified: true
            });
            await user.save();
            
            // Log activity
            await ActivityLog.create({
                user: user._id,
                action: 'User registered with Google',
                details: { email, name }
            });
        }

        const jwtToken = jwt.sign(
            { id: user._id },
            process.env.JWT_SECRET || 'secretkey',
            { expiresIn: '7d' }
        );

        const { password, ...userData } = user.toObject();
        res.json({ token: jwtToken, user: userData });
    } catch (err) {
        res.status(400).json({ message: 'Google login failed: ' + err.message });
    }
});

// ============================================================
// ============ EMAIL SERVICE =================================
// ============================================================

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function sendEmail(to, subject, html) {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to,
            subject,
            html
        });
        return true;
    } catch (err) {
        console.log('Email error:', err);
        return false;
    }
}

// ============================================================
// ============ MIDDLEWARE ====================================
// ============================================================

const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) throw new Error('No token');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secretkey');
        const user = await User.findById(decoded.id).select('-password');
        if (!user) throw new Error('User not found');
        req.user = user;
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

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, phone, company } = req.body;
        
        if (await User.findOne({ email })) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const user = new User({ name, email, password, phone, company });
        await user.save();

        await ActivityLog.create({
            user: user._id,
            action: 'User registered',
            details: { email, name }
        });

        const token = jwt.sign(
            { id: user._id },
            process.env.JWT_SECRET || 'secretkey',
            { expiresIn: '7d' }
        );

        const { password: _, ...userData } = user.toObject();
        res.status(201).json({ token, user: userData });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        
        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        await ActivityLog.create({
            user: user._id,
            action: 'User logged in',
            details: { email }
        });

        const token = jwt.sign(
            { id: user._id },
            process.env.JWT_SECRET || 'secretkey',
            { expiresIn: '7d' }
        );

        const { password: _, ...userData } = user.toObject();
        res.json({ token, user: userData });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get current user
app.get('/api/auth/me', auth, (req, res) => {
    res.json(req.user);
});

// Update profile
app.put('/api/auth/profile', auth, upload.single('avatar'), async (req, res) => {
    try {
        const updates = { ...req.body };
        if (req.file) {
            updates.avatar = '/uploads/' + req.file.filename;
        }
        
        const user = await User.findByIdAndUpdate(
            req.user._id,
            updates,
            { new: true }
        ).select('-password');
        
        await ActivityLog.create({
            user: user._id,
            action: 'Profile updated',
            details: { name: user.name }
        });

        res.json(user);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Change password
app.post('/api/auth/change-password', auth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.user._id);
        
        if (!(await user.comparePassword(currentPassword))) {
            return res.status(401).json({ message: 'Current password is incorrect' });
        }
        
        user.password = newPassword;
        await user.save();
        res.json({ message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// ============ USER MANAGEMENT (Admin) =======================
// ============================================================

app.get('/api/users', auth, adminOnly, async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 });
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/users/:id/role', auth, adminOnly, async (req, res) => {
    try {
        const { role } = req.body;
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { role },
            { new: true }
        ).select('-password');
        
        await ActivityLog.create({
            user: req.user._id,
            action: 'User role updated',
            details: { userId: user._id, newRole: role }
        });

        res.json(user);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.delete('/api/users/:id', auth, adminOnly, async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.json({ message: 'User deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// ============ ORDER ROUTES ==================================
// ============================================================

// Create order
app.post('/api/orders', auth, async (req, res) => {
    try {
        const orderData = {
            ...req.body,
            client: req.user._id,
            clientName: req.body.clientName || req.user.name,
            email: req.body.email || req.user.email,
            phone: req.body.phone || req.user.phone
        };
        
        const order = new Order(orderData);
        await order.save();

        await ActivityLog.create({
            user: req.user._id,
            action: 'Order created',
            details: { orderId: order._id, projectType: order.projectType }
        });

        // Send email notification
        await sendEmail(
            req.user.email,
            '🎨 Order Received - WebDesign Studio',
            `<h2>Hi ${req.user.name},</h2>
             <p>Your order has been received successfully!</p>
             <p><strong>Order #:</strong> ${order.orderNumber}</p>
             <p><strong>Project:</strong> ${order.projectType}</p>
             <p><strong>Description:</strong> ${order.description}</p>
             <p>We will review and get back to you within 24 hours.</p>
             <br/>
             <p>Thanks,<br/>WebDesign Studio Team</p>`
        );

        res.status(201).json(order);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get my orders
app.get('/api/orders/my-orders', auth, async (req, res) => {
    try {
        const orders = await Order.find({ client: req.user._id })
            .sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get all orders (admin)
app.get('/api/orders/all', auth, adminOnly, async (req, res) => {
    try {
        const orders = await Order.find()
            .populate('client', 'name email phone')
            .populate('assignedTo', 'name')
            .sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get order by ID
app.get('/api/orders/:id', auth, adminOnly, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('client', 'name email phone company')
            .populate('assignedTo', 'name email');
        if (!order) return res.status(404).json({ message: 'Order not found' });
        res.json(order);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Update order (admin)
app.put('/api/orders/:id', auth, adminOnly, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const oldStatus = order.status;
        const oldPrice = order.price;
        
        Object.assign(order, req.body);
        
        // Add timeline entry
        if (req.body.status && req.body.status !== oldStatus) {
            order.timeline.push({
                action: `Status changed: ${oldStatus} → ${req.body.status}`,
                by: req.user.name
            });
            
            // Send email on status change
            const user = await User.findById(order.client);
            if (user) {
                await sendEmail(
                    user.email,
                    `📋 Order Status Update - ${order.orderNumber}`,
                    `<h2>Hi ${user.name},</h2>
                     <p>Your order <strong>#${order.orderNumber}</strong> status has been updated.</p>
                     <p><strong>Status:</strong> ${req.body.status}</p>
                     <p><strong>Project:</strong> ${order.projectType}</p>
                     <p>Check your dashboard for more details.</p>
                     <br/>
                     <p>Thanks,<br/>WebDesign Studio Team</p>`
                );
            }
        }

        if (req.body.price && req.body.price !== oldPrice) {
            order.timeline.push({
                action: `Price updated: LKR ${oldPrice} → LKR ${req.body.price}`,
                by: req.user.name
            });
        }

        await order.save();

        await ActivityLog.create({
            user: req.user._id,
            action: 'Order updated',
            details: { orderId: order._id, status: order.status }
        });

        res.json(order);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Delete order (admin)
app.delete('/api/orders/:id', auth, adminOnly, async (req, res) => {
    try {
        await Order.findByIdAndDelete(req.params.id);
        res.json({ message: 'Order deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// ============ STATISTICS ====================================
// ============================================================

app.get('/api/stats', auth, adminOnly, async (req, res) => {
    try {
        const totalOrders = await Order.countDocuments();
        const pendingOrders = await Order.countDocuments({ status: 'pending' });
        const inProgressOrders = await Order.countDocuments({ status: 'in-progress' });
        const completedOrders = await Order.countDocuments({ status: 'completed' });
        const cancelledOrders = await Order.countDocuments({ status: 'cancelled' });
        const totalClients = await User.countDocuments({ role: 'client' });
        const totalAdmins = await User.countDocuments({ role: 'admin' });
        
        const revenueResult = await Order.aggregate([
            { $match: { status: 'completed', price: { $gt: 0 } } },
            { $group: { _id: null, total: { $sum: '$price' } } }
        ]);
        const totalRevenue = revenueResult[0]?.total || 0;

        // Monthly stats (last 12 months)
        const monthlyStats = await Order.aggregate([
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' }
                    },
                    count: { $sum: 1 },
                    revenue: { $sum: '$price' }
                }
            },
            { $sort: { '_id.year': -1, '_id.month': -1 } },
            { $limit: 12 }
        ]);

        // Recent orders
        const recentOrders = await Order.find()
            .populate('client', 'name')
            .sort({ createdAt: -1 })
            .limit(10);

        res.json({
            totalOrders,
            pendingOrders,
            inProgressOrders,
            completedOrders,
            cancelledOrders,
            totalRevenue,
            totalClients,
            totalAdmins,
            monthlyStats: monthlyStats.map(m => ({
                month: `${m._id.year}-${String(m._id.month).padStart(2, '0')}`,
                orders: m.count,
                revenue: m.revenue || 0
            })),
            recentOrders
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// ============ PROJECTS (Portfolio) ==========================
// ============================================================

app.get('/api/projects', async (req, res) => {
    try {
        const projects = await Project.find().sort({ featured: -1, createdAt: -1 });
        res.json(projects);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/projects', auth, adminOnly, upload.single('image'), async (req, res) => {
    try {
        const projectData = { ...req.body };
        if (req.file) projectData.image = '/uploads/' + req.file.filename;
        const project = new Project(projectData);
        await project.save();
        
        await ActivityLog.create({
            user: req.user._id,
            action: 'Project added',
            details: { title: project.title }
        });

        res.status(201).json(project);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/projects/:id', auth, adminOnly, upload.single('image'), async (req, res) => {
    try {
        const updates = { ...req.body };
        if (req.file) updates.image = '/uploads/' + req.file.filename;
        
        const project = await Project.findByIdAndUpdate(
            req.params.id,
            updates,
            { new: true }
        );
        res.json(project);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.delete('/api/projects/:id', auth, adminOnly, async (req, res) => {
    try {
        await Project.findByIdAndDelete(req.params.id);
        res.json({ message: 'Project deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// ============ TESTIMONIALS ==================================
// ============================================================

app.get('/api/testimonials', async (req, res) => {
    try {
        const testimonials = await Testimonial.find().sort({ createdAt: -1 });
        res.json(testimonials);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/testimonials', auth, adminOnly, async (req, res) => {
    try {
        const testimonial = new Testimonial(req.body);
        await testimonial.save();
        res.status(201).json(testimonial);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.delete('/api/testimonials/:id', auth, adminOnly, async (req, res) => {
    try {
        await Testimonial.findByIdAndDelete(req.params.id);
        res.json({ message: 'Testimonial deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// ============ MESSAGES ======================================
// ============================================================

app.post('/api/contact', async (req, res) => {
    try {
        const message = new Message(req.body);
        await message.save();

        await sendEmail(
            process.env.ADMIN_EMAIL || 'admin@webdesign.com',
            '📩 New Contact Message',
            `<h2>New message from ${req.body.name}</h2>
             <p><strong>Email:</strong> ${req.body.email}</p>
             <p><strong>Phone:</strong> ${req.body.phone || 'N/A'}</p>
             <p><strong>Subject:</strong> ${req.body.subject}</p>
             <p><strong>Message:</strong> ${req.body.message}</p>`
        );

        res.json({ message: 'Message sent successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/messages', auth, adminOnly, async (req, res) => {
    try {
        const messages = await Message.find()
            .populate('repliedBy', 'name')
            .sort({ createdAt: -1 });
        res.json(messages);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/messages/:id', auth, adminOnly, async (req, res) => {
    try {
        const message = await Message.findByIdAndUpdate(
            req.params.id,
            { ...req.body, repliedBy: req.user._id, repliedAt: new Date() },
            { new: true }
        );
        
        // Send reply email if replied
        if (req.body.status === 'replied' && req.body.replyMessage) {
            await sendEmail(
                message.email,
                `📩 Reply: ${message.subject}`,
                `<h2>Hi ${message.name},</h2>
                 <p>${req.body.replyMessage}</p>
                 <br/>
                 <p>Thanks,<br/>WebDesign Studio Team</p>`
            );
        }

        res.json(message);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// ============ ACTIVITY LOGS =================================
// ============================================================

app.get('/api/activities', auth, adminOnly, async (req, res) => {
    try {
        const logs = await ActivityLog.find()
            .populate('user', 'name email')
            .sort({ createdAt: -1 })
            .limit(100);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// ============ STATIC FILES ==================================
// ============================================================

app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// ============ CREATE ADMIN ==================================
// ============================================================

(async () => {
    try {
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@webdesign.com';
        const adminExists = await User.findOne({ email: adminEmail });
        if (!adminExists) {
            const admin = new User({
                name: 'Super Admin',
                email: adminEmail,
                password: process.env.ADMIN_PASSWORD || 'Admin@123',
                role: 'admin',
                isVerified: true,
                avatar: 'https://ui-avatars.com/api/?name=Admin&background=667eea&color=fff&size=128'
            });
            await admin.save();
            console.log('👑 Admin created successfully!');
            console.log('📧 Email:', adminEmail);
            console.log('🔑 Password:', process.env.ADMIN_PASSWORD || 'Admin@123');
        }
    } catch (err) {
        console.log('⚠️ Admin check error:', err.message);
    }
})();

// ============================================================
// ============ START SERVER ==================================
// ============================================================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📦 MongoDB: ${process.env.MONGODB_URI ? 'Connected ✅' : 'Not connected ❌'}`);
    console.log(`👑 Admin: ${process.env.ADMIN_EMAIL || 'admin@webdesign.com'}`);
    console.log(`🔑 Password: ${process.env.ADMIN_PASSWORD || 'Admin@123'}`);
    console.log(`\n💡 Press Ctrl+C to stop\n`);
});
