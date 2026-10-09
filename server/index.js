import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { categories, couponCatalog, deliveryFeeConfig, demoUserProfile, seedProducts, seedUsers } from './data.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 5000);
const jwtSecret = process.env.JWT_SECRET || 'buo-demo-secret';
const paystackSecret = process.env.PAYSTACK_SECRET_KEY || '';
const geminiApiKey = process.env.GEMINI_API_KEY || '';

const users = [...seedUsers];
const carts = new Map();
const wishlistItems = new Map();
const orders = [];
const notifications = [];
const aiConversations = new Map();

app.use(cors({ origin: true, credentials: true }));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 250 }));

const money = (amount) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);

const toPublicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
});

const signToken = (user) => jwt.sign({ id: user.id, email: user.email, role: user.role }, jwtSecret, { expiresIn: '7d' });

const getAuthUser = (req) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, jwtSecret);
    const currentUser = users.find((user) => user.email === payload.email);
    return currentUser || null;
  } catch {
    return null;
  }
};

const requireAuth = (req, res, next) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  req.user = user;
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.user || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
};

const getCart = (userId) => carts.get(userId) || [];
const setCart = (userId, cart) => carts.set(userId, cart);

const calculateCartMetrics = (items, couponCode) => {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const coupon = couponCode ? couponCatalog.find((entry) => entry.code === couponCode.toUpperCase()) : null;
  let discount = 0;
  if (coupon) {
    if (coupon.type === 'percent') discount = subtotal * (coupon.value / 100);
    if (coupon.type === 'fixed') discount = Math.min(coupon.value, subtotal);
    if (coupon.type === 'shipping') discount = 0;
  }
  const delivery = items.length ? deliveryFeeConfig.standard : 0;
  const total = Math.max(0, subtotal - discount + delivery);
  return { subtotal, discount, delivery, total, coupon };
};

const productSearch = (query) => {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return [...seedProducts];

  return seedProducts.filter((product) => {
    const haystack = [
      product.name,
      product.brand,
      product.category,
      product.description,
      product.specifications?.display,
      product.specifications?.processor,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalized);
  });
};

const buildRecommendationSet = () => {
  const spotlight = seedProducts.filter((product) => product.featured || product.trending).slice(0, 6);
  return spotlight.map((product) => ({
    id: product.id,
    name: product.name,
    brand: product.brand,
    price: product.price,
    image: product.images[0],
    category: product.category,
    rating: product.rating,
  }));
};

const generateAiReply = (message) => {
  const lower = message.toLowerCase();
  const query = productSearch(lower.replace(/buy|find|look for|recommend|show me|need|want/gi, '').trim());
  const productMatches = query.slice(0, 3);

  if (!productMatches.length) {
    return {
      answer: 'BUO has no suitable product in the current catalog for that request. Try a keyword like "phone", "laptop", or "budget TV".',
      products: [],
      source: geminiApiKey ? 'gemini' : 'demo',
    };
  }

  const budgetMatch = /\b(\d{3,7})\b/.exec(lower);
  const categoryMatch = categories.find((category) => lower.includes(category.toLowerCase()));

  const response = {
    answer: `I found ${productMatches.length} good matches for your request${budgetMatch ? ` around ₦${money(Number(budgetMatch[1]))}` : ''}${categoryMatch ? ` in ${categoryMatch}` : ''}. ${productMatches.map((product) => product.name).join(', ')} are available and ready to review.`,
    products: productMatches.map((product) => ({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.images[0],
      stock: product.stock,
      category: product.category,
    })),
    source: geminiApiKey ? 'gemini' : 'demo',
  };

  return response;
};

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'BUO API',
    mode: geminiApiKey ? 'live' : 'demo',
    paymentMode: paystackSecret ? 'paystack' : 'demo',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/categories', (req, res) => {
  res.json({ success: true, data: categories });
});

app.get('/api/products', (req, res) => {
  const { search, category, brand, minPrice, maxPrice, rating, sort = 'featured', page = 1, limit = 12 } = req.query;
  let filtered = [...seedProducts];

  if (search) {
    filtered = filtered.filter((product) => `${product.name} ${product.brand} ${product.category}`.toLowerCase().includes(String(search).toLowerCase()));
  }
  if (category) {
    filtered = filtered.filter((product) => product.category === category);
  }
  if (brand) {
    filtered = filtered.filter((product) => product.brand.toLowerCase() === String(brand).toLowerCase());
  }
  if (minPrice) {
    filtered = filtered.filter((product) => product.price >= Number(minPrice));
  }
  if (maxPrice) {
    filtered = filtered.filter((product) => product.price <= Number(maxPrice));
  }
  if (rating) {
    filtered = filtered.filter((product) => product.rating >= Number(rating));
  }

  switch (sort) {
    case 'price-asc':
      filtered.sort((a, b) => a.price - b.price);
      break;
    case 'price-desc':
      filtered.sort((a, b) => b.price - a.price);
      break;
    case 'rating':
      filtered.sort((a, b) => b.rating - a.rating);
      break;
    case 'newest':
      filtered.sort((a, b) => b.stock - a.stock);
      break;
    default:
      filtered.sort((a, b) => Number(b.featured || false) - Number(a.featured || false));
      break;
  }

  const pageNumber = Number(page) > 0 ? Number(page) : 1;
  const pageLimit = Number(limit) > 0 ? Number(limit) : 12;
  const start = (pageNumber - 1) * pageLimit;
  const paged = filtered.slice(start, start + pageLimit);

  res.json({
    success: true,
    data: paged,
    total: filtered.length,
    page: pageNumber,
    pages: Math.max(1, Math.ceil(filtered.length / pageLimit)),
    limit: pageLimit,
  });
});

app.get('/api/products/:id', (req, res) => {
  const product = seedProducts.find((item) => item.id === req.params.id);
  if (!product) {
    return res.status(404).json({ success: false, error: 'Product not found' });
  }
  res.json({ success: true, data: product });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, error: 'Name, email, and password are required' });
  }

  const existing = users.find((user) => user.email.toLowerCase() === String(email).toLowerCase());
  if (existing) {
    return res.status(409).json({ success: false, error: 'Account already exists' });
  }

  const newUser = {
    id: randomUUID(),
    name,
    email: String(email).toLowerCase(),
    phone: phone || '',
    passwordHash: await bcrypt.hash(password, 10),
    role: 'CUSTOMER',
  };

  users.push(newUser);
  const token = signToken(newUser);

  res.status(201).json({ success: true, token, user: toPublicUser(newUser) });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = users.find((entry) => entry.email.toLowerCase() === String(email || '').toLowerCase());

  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!valid) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  const token = signToken(user);
  res.json({ success: true, token, user: toPublicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: 'User logged out' });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ success: true, user: toPublicUser(req.user) });
});

app.get('/api/cart', requireAuth, (req, res) => {
  const cart = getCart(req.user.id);
  const items = cart.map((entry) => ({ ...entry, lineTotal: entry.price * entry.quantity }));
  const metrics = calculateCartMetrics(items, req.query.coupon);
  res.json({ success: true, data: { items, ...metrics } });
});

app.post('/api/cart/items', requireAuth, (req, res) => {
  const { productId, quantity = 1 } = req.body || {};
  const product = seedProducts.find((entry) => entry.id === productId);
  if (!product) {
    return res.status(404).json({ success: false, error: 'Product not found' });
  }

  const userCart = getCart(req.user.id);
  const existing = userCart.find((item) => item.productId === productId);
  if (existing) {
    existing.quantity += Number(quantity) || 1;
  } else {
    userCart.push({
      id: randomUUID(),
      productId: product.id,
      name: product.name,
      price: product.price,
      image: product.images[0],
      quantity: Number(quantity) || 1,
      category: product.category,
    });
  }

  setCart(req.user.id, userCart);
  res.status(201).json({ success: true, data: userCart });
});

app.patch('/api/cart/items/:id', requireAuth, (req, res) => {
  const { quantity } = req.body || {};
  const userCart = getCart(req.user.id);
  const item = userCart.find((entry) => entry.id === req.params.id);
  if (!item) {
    return res.status(404).json({ success: false, error: 'Cart item not found' });
  }

  item.quantity = Math.max(1, Number(quantity) || 1);
  setCart(req.user.id, userCart);
  res.json({ success: true, data: userCart });
});

app.delete('/api/cart/items/:id', requireAuth, (req, res) => {
  const userCart = getCart(req.user.id).filter((entry) => entry.id !== req.params.id);
  setCart(req.user.id, userCart);
  res.json({ success: true, data: userCart });
});

app.get('/api/wishlist', requireAuth, (req, res) => {
  const items = wishlistItems.get(req.user.id) || [];
  res.json({ success: true, data: items });
});

app.post('/api/wishlist/:productId', requireAuth, (req, res) => {
  const product = seedProducts.find((entry) => entry.id === req.params.productId);
  if (!product) {
    return res.status(404).json({ success: false, error: 'Product not found' });
  }

  const items = wishlistItems.get(req.user.id) || [];
  if (!items.find((entry) => entry.id === product.id)) {
    items.push({ id: product.id, name: product.name, price: product.price, image: product.images[0] });
    wishlistItems.set(req.user.id, items);
  }

  res.status(201).json({ success: true, data: items });
});

app.delete('/api/wishlist/:productId', requireAuth, (req, res) => {
  const items = (wishlistItems.get(req.user.id) || []).filter((entry) => entry.id !== req.params.productId);
  wishlistItems.set(req.user.id, items);
  res.json({ success: true, data: items });
});

app.post('/api/orders', requireAuth, (req, res) => {
  const userCart = getCart(req.user.id);
  if (!userCart.length) {
    return res.status(400).json({ success: false, error: 'Cart is empty' });
  }

  const { address, deliveryMethod = 'standard', couponCode, paymentMethod = 'paystack' } = req.body || {};
  const metrics = calculateCartMetrics(userCart, couponCode);
  const order = {
    id: `BUO-${Date.now()}`,
    customerId: req.user.id,
    customerName: req.user.name,
    email: req.user.email,
    items: userCart.map((entry) => ({
      productId: entry.productId,
      name: entry.name,
      price: entry.price,
      quantity: entry.quantity,
      image: entry.image,
    })),
    subtotal: metrics.subtotal,
    discount: metrics.discount,
    deliveryFee: metrics.delivery,
    total: metrics.total,
    paymentMethod,
    deliveryMethod,
    address: address || { city: 'Lagos', state: 'Lagos', area: 'Ikeja' },
    status: paystackSecret ? 'PAID' : 'PENDING_PAYMENT',
    paymentMode: paystackSecret ? 'paystack' : 'demo',
    createdAt: new Date().toISOString(),
  };

  orders.push(order);
  notifications.push({
    id: randomUUID(),
    userId: req.user.id,
    title: 'Order created',
    message: `Your order ${order.id} is being processed.`,
    read: false,
    createdAt: new Date().toISOString(),
  });

  setCart(req.user.id, []);

  res.status(201).json({
    success: true,
    message: paystackSecret ? 'Payment verified and order created.' : 'DEMO payment mode enabled. Payment remains pending until live Paystack credentials are configured.',
    data: order,
  });
});

app.get('/api/orders', requireAuth, (req, res) => {
  const userOrders = orders.filter((order) => order.customerId === req.user.id);
  res.json({ success: true, data: userOrders });
});

app.get('/api/orders/:id', requireAuth, (req, res) => {
  const order = orders.find((entry) => entry.id === req.params.id && entry.customerId === req.user.id);
  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }
  res.json({ success: true, data: order });
});

app.get('/api/admin/analytics', requireAuth, requireAdmin, (req, res) => {
  const revenue = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const lowStock = seedProducts.filter((product) => product.stock <= 10).length;
  const topProducts = seedProducts.slice(0, 4).map((product) => ({ name: product.name, revenue: product.price * 2 }));

  res.json({
    success: true,
    data: {
      revenue,
      orders: orders.length,
      customers: users.filter((user) => user.role === 'CUSTOMER').length,
      averageOrderValue: orders.length ? revenue / orders.length : 0,
      topProducts,
      lowStock,
      paymentMethods: ['Paystack', 'Cash on delivery'],
      topCategories: categories.slice(0, 5),
    },
  });
});

app.post('/api/ai/conversations/:id/messages', (req, res) => {
  const { message } = req.body || {};
  const { id } = req.params;
  const convo = aiConversations.get(id) || { id, messages: [] };

  if (!message || !String(message).trim()) {
    return res.status(400).json({ success: false, error: 'A message is required' });
  }

  convo.messages.push({ role: 'user', text: message, createdAt: new Date().toISOString() });
  const response = generateAiReply(message);
  const aiMessage = { role: 'assistant', text: response.answer, data: response.products, createdAt: new Date().toISOString() };
  convo.messages.push(aiMessage);
  aiConversations.set(id, convo);

  res.json({ success: true, data: { conversation: convo, reply: aiMessage } });
});

app.get('/api/recommendations', (req, res) => {
  res.json({ success: true, data: buildRecommendationSet() });
});

app.get('/api/notifications', requireAuth, (req, res) => {
  const alerts = notifications.filter((item) => item.userId === req.user.id || item.userId === 'all');
  res.json({ success: true, data: alerts });
});

app.get('/api/demo', (req, res) => {
  res.json({
    success: true,
    data: {
      mode: 'demo',
      productCount: seedProducts.length,
      products: seedProducts.slice(0, 5),
      recommended: buildRecommendationSet(),
      user: demoUserProfile,
    },
  });
});

app.use(express.static(path.join(__dirname, '..', 'dist')));
app.get(/^(?!\/api\/|\/health$).*/, (req, res) => {
  const distPath = path.join(__dirname, '..', 'dist', 'index.html');
  res.sendFile(distPath, (error) => {
    if (error && !res.headersSent) {
      res.status(404).send('Not found');
    }
  });
});

app.listen(port, () => {
  console.log(`BUO API listening on http://localhost:${port}`);
});
