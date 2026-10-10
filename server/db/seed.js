import dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { couponCatalog, seedProducts, seedUsers } from '../data.js';
import { databaseConfigured, pool } from './client.js';

dotenv.config();

if (!databaseConfigured || !pool) {
  throw new Error('Set DATABASE_URL before running the development seed.');
}
if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed production databases.');
}
if (process.env.SEED_DEVELOPMENT_DATA !== 'true') {
  throw new Error('Set SEED_DEVELOPMENT_DATA=true in your local .env to confirm this development seed.');
}

const stableUuid = (value) => {
  const hex = createHash('sha1').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const valueHex = hex.join('');
  return `${valueHex.slice(0, 8)}-${valueHex.slice(8, 12)}-${valueHex.slice(12, 16)}-${valueHex.slice(16, 20)}-${valueHex.slice(20)}`;
};

try {
  const categoryIds = new Map();
  const names = [...new Set(seedProducts.map((product) => product.category))];
  for (const name of names) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const id = stableUuid(`category:${slug}`);
    const result = await pool.query(
      `INSERT INTO categories (id, name, slug, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [id, name, slug, `${name} products`],
    );
    categoryIds.set(name, result.rows[0].id);
  }

  for (const product of seedProducts) {
    const id = stableUuid(`product:${product.id}`);
    const sku = `BUO-${product.id.toUpperCase()}`;
    const values = [
      id,
      product.name,
      product.brand,
      categoryIds.get(product.category),
      product.description,
      product.price,
      product.discount,
      JSON.stringify(product.images),
      JSON.stringify(product.variants),
      JSON.stringify(product.specifications),
      product.rating,
      product.reviewCount,
      product.stock,
      product.availability,
      product.warranty,
      product.featured || false,
      product.trending || false,
      sku,
    ];

    const inserted = await pool.query(
      `INSERT INTO products (
         id, name, brand, category_id, description, price, discount, images,
         variants, specifications, rating, review_count, stock, availability,
         warranty, featured, trending, sku
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb,
               $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (name, brand) DO NOTHING
       RETURNING id`,
      values,
    );

    const productId = inserted.rows[0]?.id || (await pool.query(
      'SELECT id FROM products WHERE name = $1 AND brand = $2',
      [product.name, product.brand],
    )).rows[0]?.id;
    if (!productId) throw new Error(`Seeded product could not be loaded: ${product.name}`);
    await pool.query(
      `INSERT INTO inventory (id, product_id, current_stock, reserved_stock, available_stock)
       VALUES ($1, $2, $3, 0, $3)
       ON CONFLICT (product_id) DO NOTHING`,
      [stableUuid(`inventory:${product.id}`), productId, product.stock],
    );
  }

  for (const user of seedUsers) {
    await pool.query(
      `INSERT INTO users (id, name, email, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO NOTHING`,
      [stableUuid(`user:${user.email}`), user.name, user.email, user.phone, user.passwordHash, user.role],
    );
  }

  for (const coupon of couponCatalog) {
    await pool.query(
      `INSERT INTO coupons (id, code, type, value, description, active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       ON CONFLICT (code) DO NOTHING`,
      [stableUuid(`coupon:${coupon.code}`), coupon.code, coupon.type, coupon.value, coupon.description],
    );
  }

  console.log(`Development seed complete: ${names.length} categories, ${seedProducts.length} products, ${seedUsers.length} users.`);
} finally {
  await pool.end();
}
