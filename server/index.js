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
import { databaseConfigured, pool, query, withTransaction } from './db/client.js';
import {
  findUserByEmail,
  findUserById,
  getProduct,
  getProductsByIds,
  listCategories,
  listProducts,
  listRecommendations,
  searchAiProducts,
} from './db/repository.js';
import { getShoppingIntent, recommendProducts } from './ai/gemini.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 5000);
const jwtSecret = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'buo-local-development-secret-change-me');
const paystackSecret = process.env.PAYSTACK_SECRET_KEY || '';
const geminiApiKey = process.env.GEMINI_API_KEY || '';

const users = [...seedUsers];
const carts = new Map();
const wishlistItems = new Map();
const orders = [];
const notifications = [];

const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map((origin) => origin.trim())
  : null;
app.use(cors({
  origin: allowedOrigins
    ? (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin is not allowed by CORS.'));
      }
    : process.env.NODE_ENV === 'production' ? false : true,
  credentials: true,
}));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 250 }));
const aiRateLimit = rateLimit({ windowMs: 60 * 1000, max: 15 });

const toPublicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
});

const signToken = (user) => jwt.sign({ id: user.id, email: user.email, role: user.role }, jwtSecret, { expiresIn: '7d' });

const getAuthUser = async (req) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch {
    return null;
  }
  return databaseConfigured
    ? await findUserById(payload.id)
    : users.find((user) => user.id === payload.id) || null;
};

const requireAuth = async (req, res, next) => {
  const user = await getAuthUser(req);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  req.user = {
    ...user,
    passwordHash: user.passwordHash || user.password_hash,
  };
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

const getDatabaseCart = async (userId, client = pool) => {
  const result = await client.query(
    `SELECT ci.id, p.id AS "productId", p.name, p.price, p.images, p.stock,
            c.name AS category, ci.quantity
     FROM carts cart
     JOIN cart_items ci ON ci.cart_id = cart.id AND ci.save_for_later = FALSE
     JOIN products p ON p.id = ci.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE cart.user_id = $1 AND p.is_deleted = FALSE
     ORDER BY ci.created_at`,
    [userId],
  );
  return result.rows.map((row) => ({
    ...row,
    price: Number(row.price),
    quantity: Number(row.quantity),
    stock: Number(row.stock),
    image: row.images?.[0] || '',
    lineTotal: Number(row.price) * Number(row.quantity),
  }));
};

const calculateDatabaseCartMetrics = async (items, couponCode, deliveryMethod = 'standard', client = pool) => {
  const delivery = items.length ? deliveryFeeConfig[deliveryMethod] : 0;
  let discount = 0;
  let coupon = null;
  if (couponCode) {
    const result = await client.query(
      `SELECT code, type, value, description FROM coupons
       WHERE upper(code) = upper($1) AND active = TRUE
         AND (start_at IS NULL OR start_at <= NOW())
         AND (end_at IS NULL OR end_at >= NOW())
         AND (usage_limit IS NULL OR usage_limit > 0)
       LIMIT 1`,
      [couponCode],
    );
    coupon = result.rows[0] || null;
    if (coupon?.type === 'percent') discount = items.reduce((sum, item) => sum + item.price * item.quantity, 0) * Number(coupon.value) / 100;
    if (coupon?.type === 'fixed') discount = Math.min(Number(coupon.value), items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  }
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shippingDiscount = coupon?.type === 'shipping' ? delivery : 0;
  return {
    subtotal,
    discount,
    delivery: delivery - shippingDiscount,
    total: Math.max(0, subtotal - discount + delivery - shippingDiscount),
    coupon,
  };
};

const calculateCartMetrics = (items, couponCode, deliveryMethod = 'standard') => {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const coupon = couponCode ? couponCatalog.find((entry) => entry.code === couponCode.toUpperCase()) : null;
  let discount = 0;
  if (coupon) {
    if (coupon.type === 'percent') discount = subtotal * (coupon.value / 100);
    if (coupon.type === 'fixed') discount = Math.min(coupon.value, subtotal);
    if (coupon.type === 'shipping') discount = 0;
  }
  const delivery = items.length ? deliveryFeeConfig[deliveryMethod] ?? deliveryFeeConfig.standard : 0;
  const shippingDiscount = coupon?.type === 'shipping' ? delivery : 0;
  const total = Math.max(0, subtotal - discount + delivery - shippingDiscount);
  return { subtotal, discount, delivery: delivery - shippingDiscount, total, coupon };
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

app.get('/health', async (req, res) => {
  let database = 'demo';
  if (databaseConfigured) {
    await query('SELECT 1');
    database = 'postgresql';
  }
  res.json({
    status: 'ok',
    service: 'BUO API',
    mode: databaseConfigured ? 'live' : 'demo',
    database,
    gemini: geminiApiKey ? 'configured' : 'unavailable',
    paymentMode: paystackSecret ? 'configured_not_integrated' : 'demo',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health/live', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/categories', async (req, res) => {
  const data = databaseConfigured ? await listCategories() : categories;
  res.json({ success: true, data });
});

app.get('/api/delivery-options', (req, res) => {
  res.json({
    success: true,
    data: [
      { id: 'standard', label: 'Standard delivery', fee: deliveryFeeConfig.standard },
      { id: 'express', label: 'Express delivery', fee: deliveryFeeConfig.express },
      { id: 'pickup', label: 'Pickup', fee: deliveryFeeConfig.pickup },
    ],
  });
});

app.get('/api/products', async (req, res) => {
  const { search, category, brand, minPrice, maxPrice, rating, availability, sort = 'featured', page = 1, limit = 12 } = req.query;
  const filters = { search, category, brand, minPrice, maxPrice, rating, availability, sort, page, limit };
  for (const key of ['minPrice', 'maxPrice', 'rating']) {
    if (filters[key] !== undefined && filters[key] !== '' && !Number.isFinite(Number(filters[key]))) {
      return res.status(400).json({ success: false, error: `Invalid ${key}`, code: 'INVALID_FILTER' });
    }
  }
  if (Number(minPrice) < 0 || Number(maxPrice) < 0 || Number(rating) < 0 || Number(rating) > 5) {
    return res.status(400).json({ success: false, error: 'Price filters must be non-negative and rating must be from 0 to 5', code: 'INVALID_FILTER' });
  }
  if (String(search || '').length > 120 || String(category || '').length > 80 || String(brand || '').length > 80) {
    return res.status(400).json({ success: false, error: 'Search filters are too long', code: 'INVALID_FILTER' });
  }
  if (databaseConfigured) {
    const result = await listProducts(filters);
    return res.json({ success: true, ...result });
  }

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
  if (availability === 'in-stock') {
    filtered = filtered.filter((product) => product.stock > 0);
  }
  if (availability === 'out-of-stock') {
    filtered = filtered.filter((product) => product.stock === 0);
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

app.get('/api/products/:id', async (req, res) => {
  const product = databaseConfigured
    ? await getProduct(req.params.id)
    : seedProducts.find((item) => item.id === req.params.id);
  if (!product) {
    return res.status(404).json({ success: false, error: 'Product not found' });
  }
  res.json({ success: true, data: product });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ success: false, error: 'Provide a name, valid email, and password of at least 8 characters', code: 'INVALID_REGISTRATION' });
  }

  if (databaseConfigured) {
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    try {
      const result = await query(
        `INSERT INTO users (id, name, email, phone, password_hash, role)
         VALUES ($1, $2, lower($3), $4, $5, 'CUSTOMER')
         RETURNING id, name, email, phone, role`,
        [id, name.trim(), email.trim(), typeof phone === 'string' ? phone.trim() : '', passwordHash],
      );
      const newUser = result.rows[0];
      return res.status(201).json({ success: true, token: signToken(newUser), user: toPublicUser(newUser) });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ success: false, error: 'Account already exists', code: 'ACCOUNT_EXISTS' });
      }
      throw error;
    }
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
  const user = databaseConfigured
    ? await findUserByEmail(String(email || ''))
    : users.find((entry) => entry.email.toLowerCase() === String(email || '').toLowerCase());

  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(String(password || ''), user.passwordHash || user.password_hash);
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

app.get('/api/cart', requireAuth, async (req, res) => {
  if (databaseConfigured) {
    const deliveryMethod = req.query.deliveryMethod || 'standard';
    if (!Object.hasOwn(deliveryFeeConfig, deliveryMethod)) {
      return res.status(400).json({ success: false, error: 'Invalid delivery method', code: 'INVALID_DELIVERY_METHOD' });
    }
    const items = await getDatabaseCart(req.user.id);
    const metrics = await calculateDatabaseCartMetrics(
      items,
      req.query.coupon,
      deliveryMethod,
    );
    return res.json({ success: true, data: { items, ...metrics } });
  }
  const cart = getCart(req.user.id);
  const items = cart.map((entry) => ({ ...entry, lineTotal: entry.price * entry.quantity }));
  const metrics = calculateCartMetrics(items, req.query.coupon);
  res.json({ success: true, data: { items, ...metrics } });
});

app.post('/api/cart/items', requireAuth, async (req, res) => {
  const { productId, quantity = 1 } = req.body || {};
  const requestedQuantity = Number(quantity);
  if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 99) {
    return res.status(400).json({ success: false, error: 'Quantity must be an integer from 1 to 99', code: 'INVALID_QUANTITY' });
  }
  if (databaseConfigured) {
    const cart = await withTransaction(async (client) => {
      const productResult = await client.query(
        `SELECT p.id, p.stock FROM products p
         WHERE p.id::text = $1 AND p.is_deleted = FALSE FOR UPDATE`,
        [productId],
      );
      if (!productResult.rowCount) return null;
      const product = productResult.rows[0];
      const cartResult = await client.query(
        `INSERT INTO carts (id, user_id) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [randomUUID(), req.user.id],
      );
      const cartId = cartResult.rows[0].id;
      const currentResult = await client.query(
        `SELECT quantity FROM cart_items
         WHERE cart_id = $1 AND product_id = $2 AND save_for_later = FALSE`,
        [cartId, product.id],
      );
      const currentQuantity = Number(currentResult.rows[0]?.quantity || 0);
      if (currentQuantity + requestedQuantity > Number(product.stock)) {
        return { stockError: true, stock: Number(product.stock) };
      }
      await client.query(
        `INSERT INTO cart_items (id, cart_id, product_id, product_snapshot, quantity)
         VALUES ($1, $2, $3, '{}'::jsonb, $4)
         ON CONFLICT (cart_id, product_id) WHERE save_for_later = FALSE
         DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = NOW()`,
        [randomUUID(), cartId, product.id, requestedQuantity],
      );
      await client.query('UPDATE carts SET updated_at = NOW() WHERE id = $1', [cartId]);
      return { items: await getDatabaseCart(req.user.id, client) };
    });
    if (!cart) return res.status(404).json({ success: false, error: 'Product not found', code: 'PRODUCT_NOT_FOUND' });
    if (cart.stockError) return res.status(409).json({ success: false, error: `Only ${cart.stock} units are currently available`, code: 'INSUFFICIENT_STOCK' });
    return res.status(201).json({ success: true, data: cart.items });
  }

  const product = seedProducts.find((entry) => entry.id === productId);
  if (!product) {
    return res.status(404).json({ success: false, error: 'Product not found' });
  }

  const userCart = getCart(req.user.id);
  const existing = userCart.find((item) => item.productId === productId);
  if (existing) {
    existing.quantity += requestedQuantity;
  } else {
    userCart.push({
      id: randomUUID(),
      productId: product.id,
      name: product.name,
      price: product.price,
      image: product.images[0],
      quantity: requestedQuantity,
      category: product.category,
    });
  }

  setCart(req.user.id, userCart);
  res.status(201).json({ success: true, data: userCart });
});

app.patch('/api/cart/items/:id', requireAuth, async (req, res) => {
  const { quantity } = req.body || {};
  const requestedQuantity = Number(quantity);
  if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 99) {
    return res.status(400).json({ success: false, error: 'Quantity must be an integer from 1 to 99', code: 'INVALID_QUANTITY' });
  }
  if (databaseConfigured) {
    const result = await query(
      `UPDATE cart_items ci
       SET quantity = $1, updated_at = NOW()
       FROM carts cart, products p
       WHERE ci.id::text = $2 AND ci.cart_id = cart.id AND cart.user_id = $3
         AND ci.product_id = p.id AND p.is_deleted = FALSE AND p.stock >= $1
       RETURNING ci.id`,
      [requestedQuantity, req.params.id, req.user.id],
    );
    if (!result.rowCount) {
      return res.status(409).json({ success: false, error: 'Cart item not found or requested quantity exceeds available stock', code: 'CART_UPDATE_FAILED' });
    }
    return res.json({ success: true, data: await getDatabaseCart(req.user.id) });
  }
  const userCart = getCart(req.user.id);
  const item = userCart.find((entry) => entry.id === req.params.id);
  if (!item) {
    return res.status(404).json({ success: false, error: 'Cart item not found' });
  }

  item.quantity = requestedQuantity;
  setCart(req.user.id, userCart);
  res.json({ success: true, data: userCart });
});

app.delete('/api/cart/items/:id', requireAuth, async (req, res) => {
  if (databaseConfigured) {
    await query(
      `DELETE FROM cart_items ci USING carts cart
       WHERE ci.id::text = $1 AND ci.cart_id = cart.id AND cart.user_id = $2`,
      [req.params.id, req.user.id],
    );
    return res.json({ success: true, data: await getDatabaseCart(req.user.id) });
  }
  const userCart = getCart(req.user.id).filter((entry) => entry.id !== req.params.id);
  setCart(req.user.id, userCart);
  res.json({ success: true, data: userCart });
});

app.get('/api/wishlist', requireAuth, async (req, res) => {
  if (databaseConfigured) {
    const result = await query(
      `SELECT p.id, p.name, p.price, p.images AS image
       FROM wishlists w
       JOIN wishlist_items wi ON wi.wishlist_id = w.id
       JOIN products p ON p.id = wi.product_id
       WHERE w.user_id = $1 AND p.is_deleted = FALSE
       ORDER BY wi.created_at DESC`,
      [req.user.id],
    );
    return res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        price: Number(row.price),
        image: row.image?.[0] || '',
      })),
    });
  }
  const items = wishlistItems.get(req.user.id) || [];
  res.json({ success: true, data: items });
});

app.post('/api/wishlist/:productId', requireAuth, async (req, res) => {
  if (databaseConfigured) {
    const result = await withTransaction(async (client) => {
      const product = await client.query(
        'SELECT id FROM products WHERE id::text = $1 AND is_deleted = FALSE',
        [req.params.productId],
      );
      if (!product.rowCount) return null;
      let wishlist = await client.query(
        'SELECT id FROM wishlists WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [req.user.id],
      );
      if (!wishlist.rowCount) {
        wishlist = await client.query(
          'INSERT INTO wishlists (id, user_id) VALUES ($1, $2) RETURNING id',
          [randomUUID(), req.user.id],
        );
      }
      await client.query(
        `INSERT INTO wishlist_items (id, wishlist_id, product_id)
         VALUES ($1, $2, $3) ON CONFLICT (wishlist_id, product_id) DO NOTHING`,
        [randomUUID(), wishlist.rows[0].id, product.rows[0].id],
      );
      return true;
    });
    if (!result) return res.status(404).json({ success: false, error: 'Product not found', code: 'PRODUCT_NOT_FOUND' });
    const items = await query(
      `SELECT p.id, p.name, p.price, p.images AS image
       FROM wishlists w JOIN wishlist_items wi ON wi.wishlist_id = w.id
       JOIN products p ON p.id = wi.product_id
       WHERE w.user_id = $1 AND p.is_deleted = FALSE`,
      [req.user.id],
    );
    return res.status(201).json({
      success: true,
      data: items.rows.map((row) => ({ ...row, price: Number(row.price), image: row.image?.[0] || '' })),
    });
  }
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

app.delete('/api/wishlist/:productId', requireAuth, async (req, res) => {
  if (databaseConfigured) {
    await query(
      `DELETE FROM wishlist_items wi USING wishlists w
       WHERE wi.wishlist_id = w.id AND w.user_id = $1 AND wi.product_id::text = $2`,
      [req.user.id, req.params.productId],
    );
    return res.json({ success: true });
  }
  const items = (wishlistItems.get(req.user.id) || []).filter((entry) => entry.id !== req.params.productId);
  wishlistItems.set(req.user.id, items);
  res.json({ success: true, data: items });
});

app.post('/api/orders', requireAuth, async (req, res) => {
  const userCart = getCart(req.user.id);
  const { address, deliveryMethod = 'standard', couponCode, paymentMethod = 'paystack' } = req.body || {};
  if (databaseConfigured) {
    if (!['standard', 'express', 'pickup'].includes(deliveryMethod)) {
      return res.status(400).json({ success: false, error: 'Invalid delivery method', code: 'INVALID_DELIVERY_METHOD' });
    }
    if (!address || typeof address !== 'object' || !address.fullName || !address.email || !address.phone || !address.state || !address.city || !address.streetAddress) {
      return res.status(400).json({ success: false, error: 'Complete delivery name, email, phone, state, city, and street address are required', code: 'INVALID_ADDRESS' });
    }

    const created = await withTransaction(async (client) => {
      const cartResult = await client.query(
        `SELECT cart.id AS cart_id, ci.id AS cart_item_id, ci.quantity,
                p.id AS product_id, p.name, p.brand, p.price, p.stock, p.images,
                p.variants, p.specifications, p.warranty, c.name AS category
         FROM carts cart JOIN cart_items ci ON ci.cart_id = cart.id AND ci.save_for_later = FALSE
         JOIN products p ON p.id = ci.product_id
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE cart.user_id = $1 AND p.is_deleted = FALSE
         ORDER BY p.id
         FOR UPDATE OF ci, p`,
        [req.user.id],
      );
      const items = cartResult.rows.map((row) => ({
        ...row,
        price: Number(row.price),
        quantity: Number(row.quantity),
        stock: Number(row.stock),
      }));
      if (!items.length) return { error: 'Cart is empty', code: 'EMPTY_CART', status: 400 };
      const unavailable = items.find((item) => item.quantity > item.stock);
      if (unavailable) return { error: `${unavailable.name} no longer has enough stock`, code: 'INSUFFICIENT_STOCK', status: 409 };

      const metrics = await calculateDatabaseCartMetrics(items, couponCode, deliveryMethod, client);
      if (couponCode && !metrics.coupon) {
        return { error: 'Coupon is invalid or expired', code: 'INVALID_COUPON', status: 400 };
      }

      const orderId = randomUUID();
      const orderNumber = `BUO-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
      const selectedPaymentMethod = 'DEMO';
      await client.query(
        `INSERT INTO orders (
           id, user_id, order_number, subtotal, discount, delivery_fee, total,
           payment_method, payment_status, order_status, delivery_method, delivery_address, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', 'PENDING_PAYMENT', $9, $10::jsonb, NOW() + INTERVAL '15 minutes')`,
        [
          orderId,
          req.user.id,
          orderNumber,
          metrics.subtotal,
          metrics.discount,
          metrics.delivery,
          metrics.total,
          selectedPaymentMethod,
          deliveryMethod,
          JSON.stringify(address),
        ],
      );

      for (const item of items) {
        const snapshot = {
          id: item.product_id,
          name: item.name,
          brand: item.brand,
          category: item.category,
          price: item.price,
          images: item.images,
          variants: item.variants,
          specifications: item.specifications,
          warranty: item.warranty,
        };
        await client.query(
          `INSERT INTO order_items (id, order_id, product_id, product_name, product_snapshot, quantity, unit_price)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [randomUUID(), orderId, item.product_id, item.name, JSON.stringify(snapshot), item.quantity, item.price],
        );
        const stockUpdate = await client.query(
          `UPDATE products SET stock = stock - $1, updated_at = NOW()
           WHERE id = $2 AND stock >= $1`,
          [item.quantity, item.product_id],
        );
        if (!stockUpdate.rowCount) {
          const error = new Error('Stock changed while placing order');
          error.code = 'INSUFFICIENT_STOCK';
          throw error;
        }
        await client.query(
          `UPDATE inventory
           SET reserved_stock = reserved_stock + $1,
               available_stock = GREATEST(0, available_stock - $1),
               updated_at = NOW()
           WHERE product_id = $2`,
          [item.quantity, item.product_id],
        );
        await client.query(
          `INSERT INTO inventory_movements (id, product_id, movement_type, quantity, reason, reference)
           VALUES ($1, $2, 'RESERVED', $3, 'Customer checkout pending payment', $4)`,
          [randomUUID(), item.product_id, item.quantity, orderNumber],
        );
      }

      await client.query(
        `INSERT INTO payments (id, order_id, provider, reference, amount, currency, status)
         VALUES ($1, $2, $3, $4, $5, 'NGN', 'PENDING')`,
        [randomUUID(), orderId, selectedPaymentMethod, orderNumber, metrics.total],
      );
      await client.query(
        `INSERT INTO deliveries (id, order_id, status, tracking_code)
         VALUES ($1, $2, 'PENDING', $3)`,
        [randomUUID(), orderId, orderNumber],
      );
      await client.query(
        `INSERT INTO notifications (id, user_id, title, message, type)
         VALUES ($1, $2, 'Order created', $3, 'order')`,
        [randomUUID(), req.user.id, `Your order ${orderNumber} was created and is awaiting payment.`],
      );
      if (cartResult.rows[0]?.cart_id) {
        await client.query('DELETE FROM cart_items WHERE cart_id = $1 AND save_for_later = FALSE', [cartResult.rows[0].cart_id]);
      }
      return {
        order: {
          id: orderNumber,
          status: 'PENDING_PAYMENT',
          paymentStatus: 'PENDING',
          paymentMode: selectedPaymentMethod,
          items: items.map((item) => ({
            productId: item.product_id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            image: item.images?.[0] || '',
          })),
          ...metrics,
          deliveryMethod,
          address,
        },
      };
    });
    if (created.error) {
      return res.status(created.status).json({ success: false, error: created.error, code: created.code });
    }
    return res.status(201).json({
      success: true,
      message: 'Order saved. Payment remains pending until a verified payment provider confirms it.',
      data: created.order,
    });
  }

  if (!userCart.length) {
    return res.status(400).json({ success: false, error: 'Cart is empty' });
  }

  const metrics = calculateCartMetrics(userCart, couponCode, deliveryMethod);
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
    status: 'PENDING_PAYMENT',
    paymentMode: 'demo',
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
    message: 'Payment is not integrated. The order remains pending and no money has been collected.',
    data: order,
  });
});

app.get('/api/orders', requireAuth, async (req, res) => {
  if (databaseConfigured) {
    const result = await query(
      `SELECT id, order_number AS "orderNumber", subtotal, discount, delivery_fee AS "deliveryFee",
              total, payment_method AS "paymentMethod", payment_status AS "paymentStatus",
              order_status AS status, delivery_method AS "deliveryMethod",
              delivery_address AS address, created_at AS "createdAt"
       FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id],
    );
    const orderIds = result.rows.map((order) => order.id);
    const itemResult = orderIds.length
      ? await query(
          `SELECT order_id, product_id AS "productId", product_name AS name,
                  quantity, unit_price AS price, product_snapshot
           FROM order_items WHERE order_id = ANY($1::uuid[])`,
          [orderIds],
        )
      : { rows: [] };
    const itemsByOrder = new Map();
    for (const item of itemResult.rows) {
      const items = itemsByOrder.get(item.order_id) || [];
      items.push({
        productId: item.productId,
        name: item.name,
        price: Number(item.price),
        quantity: Number(item.quantity),
        image: item.product_snapshot?.images?.[0] || '',
      });
      itemsByOrder.set(item.order_id, items);
    }
    return res.json({
      success: true,
      data: result.rows.map((order) => ({
        ...order,
        id: order.orderNumber,
        subtotal: Number(order.subtotal),
        discount: Number(order.discount),
        deliveryFee: Number(order.deliveryFee),
        total: Number(order.total),
        items: itemsByOrder.get(order.id) || [],
      })),
    });
  }
  const userOrders = orders.filter((order) => order.customerId === req.user.id);
  res.json({ success: true, data: userOrders });
});

app.get('/api/orders/:id', requireAuth, async (req, res) => {
  if (databaseConfigured) {
    const orderResult = await query(
      `SELECT id, order_number AS "orderNumber", subtotal, discount, delivery_fee AS "deliveryFee",
              total, payment_method AS "paymentMethod", payment_status AS "paymentStatus",
              order_status AS status, delivery_method AS "deliveryMethod",
              delivery_address AS address, created_at AS "createdAt"
       FROM orders WHERE order_number = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );
    if (!orderResult.rowCount) return res.status(404).json({ success: false, error: 'Order not found' });
    const order = orderResult.rows[0];
    const items = await query(
      `SELECT product_id AS "productId", product_name AS name, quantity,
              unit_price AS price, product_snapshot
       FROM order_items WHERE order_id = $1`,
      [order.id],
    );
    return res.json({
      success: true,
      data: {
        ...order,
        id: order.orderNumber,
        subtotal: Number(order.subtotal),
        discount: Number(order.discount),
        deliveryFee: Number(order.deliveryFee),
        total: Number(order.total),
        items: items.rows.map((item) => ({
          productId: item.productId,
          name: item.name,
          quantity: Number(item.quantity),
          price: Number(item.price),
          image: item.product_snapshot?.images?.[0] || '',
        })),
      },
    });
  }
  const order = orders.find((entry) => entry.id === req.params.id && entry.customerId === req.user.id);
  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }
  res.json({ success: true, data: order });
});

app.get('/api/admin/analytics', requireAuth, requireAdmin, async (req, res) => {
  if (databaseConfigured) {
    const [summary, lowStock, topProducts, topCategories, customers] = await Promise.all([
      query(
        `SELECT COALESCE(SUM(total) FILTER (WHERE payment_status = 'PAID'), 0) AS revenue,
                COUNT(*)::int AS orders,
                COUNT(*) FILTER (WHERE payment_status = 'PAID')::int AS paid_orders
         FROM orders`,
      ),
      query('SELECT COUNT(*)::int AS count FROM products WHERE is_deleted = FALSE AND stock <= 10'),
      query(
        `SELECT oi.product_name AS name, SUM(oi.unit_price * oi.quantity) AS revenue
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.payment_status = 'PAID'
         GROUP BY oi.product_name ORDER BY revenue DESC LIMIT 5`,
      ),
      query(
        `SELECT c.name, SUM(oi.unit_price * oi.quantity) AS revenue
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id
         WHERE o.payment_status = 'PAID'
         GROUP BY c.name ORDER BY revenue DESC LIMIT 5`,
      ),
      query(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'CUSTOMER'`),
    ]);
    const revenue = Number(summary.rows[0].revenue);
    const paidOrders = Number(summary.rows[0].paid_orders);
    return res.json({
      success: true,
      data: {
        revenue,
        orders: Number(summary.rows[0].orders),
        customers: Number(customers.rows[0].count),
        averageOrderValue: paidOrders ? revenue / paidOrders : 0,
        topProducts: topProducts.rows.map((row) => ({ name: row.name, revenue: Number(row.revenue) })),
        lowStock: Number(lowStock.rows[0].count),
        paymentMethods: ['Paystack', 'DEMO'],
        topCategories: topCategories.rows.map((row) => row.name),
      },
    });
  }
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

app.post('/api/ai/conversations/:id/messages', aiRateLimit, async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > 1000) {
    return res.status(400).json({ success: false, error: 'Message must contain 1 to 1000 characters', code: 'INVALID_MESSAGE' });
  }
  if (!databaseConfigured) {
    return res.status(503).json({ success: false, error: 'AI shopping requires a configured PostgreSQL catalog', code: 'DATABASE_UNAVAILABLE' });
  }
  if (!geminiApiKey) {
    return res.status(503).json({ success: false, error: 'Gemini is not configured. Add GEMINI_API_KEY to the backend environment.', code: 'GEMINI_NOT_CONFIGURED' });
  }

  const requestedConversationId = /^[0-9a-f-]{36}$/i.test(req.params.id) ? req.params.id : null;
  const user = await getAuthUser(req);
  let conversationId = requestedConversationId || randomUUID();
  if (requestedConversationId) {
    const existingConversation = await query(
      'SELECT user_id FROM ai_conversations WHERE id = $1',
      [requestedConversationId],
    );
    if (existingConversation.rowCount && existingConversation.rows[0].user_id !== (user?.id || null)) {
      return res.status(404).json({ success: false, error: 'Conversation not found', code: 'CONVERSATION_NOT_FOUND' });
    }
    if (!existingConversation.rowCount) conversationId = randomUUID();
  }
  let intent;
  try {
    intent = await getShoppingIntent(geminiApiKey, message, req.body?.context || null);
  } catch (error) {
    console.error('BUO Gemini intent request failed:', error.status || error.name);
    return res.status(502).json({
      success: false,
      error: 'The BUO AI assistant could not understand the request. Please try again.',
      code: 'GEMINI_REQUEST_FAILED',
    });
  }

  const candidates = await searchAiProducts(intent);
  let answer;
  let products = [];
  let structuredOutput;
  if (!candidates.length) {
    answer = 'BUO has no suitable product in the current catalog for those requirements. Try changing the product type or budget.';
    structuredOutput = { intent, productIds: [] };
  } else {
    let recommendation;
    try {
      recommendation = await recommendProducts(geminiApiKey, message, intent, candidates);
    } catch (error) {
      console.error('BUO Gemini recommendation request failed:', error.status || error.name);
      return res.status(502).json({
        success: false,
        error: 'The BUO AI assistant could not complete the recommendation. Please try again.',
        code: 'GEMINI_REQUEST_FAILED',
      });
    }
    const candidateIds = new Set(candidates.map((product) => product.id));
    const verifiedIds = recommendation.productIds.filter((id) => candidateIds.has(id));
    products = await getProductsByIds(verifiedIds);
    answer = products.length
      ? `I found ${products.length} matching product${products.length === 1 ? '' : 's'}. The prices, availability, and specifications below are from BUO's catalog.`
      : 'BUO has no suitable product in the current catalog for those requirements. Try changing the product type or budget.';
    structuredOutput = { intent, productIds: products.map((product) => product.id) };
  }

    const reply = {
      role: 'assistant',
      text: answer,
      data: products.map((product) => ({
        id: product.id,
        name: product.name,
        brand: product.brand,
        category: product.category,
        price: product.price,
        stock: product.stock,
        images: product.images,
        discount: product.discount,
        rating: product.rating,
        reviewCount: product.reviewCount,
        variants: product.variants,
        specifications: product.specifications,
      })),
      createdAt: new Date().toISOString(),
    };
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO ai_conversations (id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
        [conversationId, user?.id || null],
      );
      await client.query(
        `INSERT INTO ai_messages (id, conversation_id, sender, message)
         VALUES ($1, $2, 'customer', $3)`,
        [randomUUID(), conversationId, message],
      );
      await client.query(
        `INSERT INTO ai_messages (id, conversation_id, sender, message, structured_output)
         VALUES ($1, $2, 'assistant', $3, $4::jsonb)`,
        [randomUUID(), conversationId, answer, JSON.stringify(structuredOutput)],
      );
    });
  res.json({ success: true, data: { conversationId, reply } });
});

app.get('/api/recommendations', async (req, res) => {
  const data = databaseConfigured ? await listRecommendations() : buildRecommendationSet();
  res.json({ success: true, data });
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  if (databaseConfigured) {
    const result = await query(
      `SELECT id, title, message, type, read_at AS "readAt", created_at AS "createdAt"
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id],
    );
    return res.json({ success: true, data: result.rows });
  }
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

const releaseExpiredReservations = async () => {
  if (!databaseConfigured) return 0;
  return withTransaction(async (client) => {
    const expired = await client.query(
      `SELECT id, order_number, user_id
       FROM orders
       WHERE payment_status = 'PENDING' AND order_status = 'PENDING_PAYMENT'
         AND expires_at <= NOW()
       ORDER BY expires_at
       LIMIT 50
       FOR UPDATE SKIP LOCKED
       `,
    );
    for (const order of expired.rows) {
      const items = await client.query(
        'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
        [order.id],
      );
      for (const item of items.rows) {
        const quantity = Number(item.quantity);
        await client.query(
          'UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2',
          [quantity, item.product_id],
        );
        await client.query(
          `UPDATE inventory
           SET reserved_stock = GREATEST(0, reserved_stock - $1),
               available_stock = available_stock + $1,
               updated_at = NOW()
           WHERE product_id = $2`,
          [quantity, item.product_id],
        );
        await client.query(
          `INSERT INTO inventory_movements (id, product_id, movement_type, quantity, reason, reference)
           VALUES ($1, $2, 'RELEASED', $3, 'Pending payment expired', $4)`,
          [randomUUID(), item.product_id, quantity, order.order_number],
        );
      }
      const payments = await client.query(
        `UPDATE payments SET status = 'CANCELLED', updated_at = NOW()
         WHERE order_id = $1 AND status = 'PENDING' RETURNING id`,
        [order.id],
      );
      for (const payment of payments.rows) {
        await client.query(
          `INSERT INTO payment_events (id, payment_id, event_type, payload)
           VALUES ($1, $2, 'reservation_expired', $3::jsonb)`,
          [randomUUID(), payment.id, JSON.stringify({ orderNumber: order.order_number })],
        );
      }
      await client.query(
        `UPDATE orders SET order_status = 'CANCELLED', payment_status = 'CANCELLED', updated_at = NOW()
         WHERE id = $1`,
        [order.id],
      );
      await client.query(
        `UPDATE deliveries SET status = 'CANCELLED', updated_at = NOW() WHERE order_id = $1`,
        [order.id],
      );
      if (order.user_id) {
        await client.query(
          `INSERT INTO notifications (id, user_id, title, message, type)
           VALUES ($1, $2, 'Reservation expired', $3, 'order')`,
          [randomUUID(), order.user_id, `Order ${order.order_number} expired before payment; reserved stock is available again.`],
        );
      }
    }
    return expired.rowCount;
  });
};

app.use(express.static(path.join(__dirname, '..', 'dist')));
app.get(/^(?!\/api\/|\/health$).*/, (req, res) => {
  const distPath = path.join(__dirname, '..', 'dist', 'index.html');
  res.sendFile(distPath, (error) => {
    if (error && !res.headersSent) {
      res.status(404).send('Not found');
    }
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('BUO request failed:', error.code || error.name || 'ERROR');
  if (error.code === 'INSUFFICIENT_STOCK') {
    return res.status(409).json({
      success: false,
      error: 'Stock changed while placing the order. Please review your cart.',
      code: 'INSUFFICIENT_STOCK',
    });
  }
  res.status(500).json({
    success: false,
    error: 'An unexpected server error occurred.',
    code: 'INTERNAL_SERVER_ERROR',
  });
});

if (process.env.NODE_ENV === 'production' && (!jwtSecret || jwtSecret === 'change-me-in-production')) {
  throw new Error('Set a strong JWT_SECRET before starting BUO in production.');
}

const start = async () => {
  if (process.env.NODE_ENV === 'production' && !databaseConfigured) {
    throw new Error('DATABASE_URL must be configured before starting BUO in production.');
  }
  if (databaseConfigured) {
    await query('SELECT 1');
    const migrationStatus = await query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'schema_migrations'
       ) AS has_migrations`,
    );
    if (!migrationStatus.rows[0].has_migrations) {
      throw new Error('Database migrations are missing. Run npm run db:migrate first.');
    }
    const latestMigration = await query(
      "SELECT 1 FROM schema_migrations WHERE version = '005_inventory_product_key.sql'",
    );
    if (!latestMigration.rowCount) {
      throw new Error('Database migrations are incomplete. Run npm run db:migrate first.');
    }
    console.log('BUO connected to PostgreSQL.');
    await releaseExpiredReservations();
  } else {
    console.warn('PostgreSQL is not configured; the API is running in demo catalog mode.');
  }
  const server = app.listen(port, () => {
    console.log(`BUO API listening on http://localhost:${port}`);
  });
  if (databaseConfigured) {
    const cleanupTimer = setInterval(() => {
      releaseExpiredReservations().catch((error) => {
        console.error('Could not release expired order reservations:', error.code || error.name);
      });
    }, 60_000);
    cleanupTimer.unref();
    server.on('close', () => clearInterval(cleanupTimer));
  }
};

start().catch((error) => {
  console.error('BUO startup failed:', error.message);
  process.exitCode = 1;
});
