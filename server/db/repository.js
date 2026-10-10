import { query } from './client.js';

const productSelect = `
  SELECT p.id, p.name, p.brand, c.name AS category, p.description, p.price,
         p.discount, p.images, p.variants, p.specifications, p.rating,
         p.review_count AS "reviewCount", p.stock, p.availability, p.warranty,
         p.featured, p.trending
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
`;

const normalizeProduct = (row) => ({
  ...row,
  price: Number(row.price),
  discount: Number(row.discount || 0),
  rating: Number(row.rating || 0),
  reviewCount: Number(row.reviewCount || 0),
  stock: Number(row.stock || 0),
  images: row.images || [],
  variants: row.variants || [],
  specifications: row.specifications || {},
  availability: Number(row.stock || 0) === 0
    ? 'Out of stock'
    : Number(row.stock) <= 10
      ? 'Low stock'
      : 'In stock',
});

export const listProducts = async ({
  search,
  category,
  brand,
  minPrice,
  maxPrice,
  rating,
  availability,
  sort = 'featured',
  page = 1,
  limit = 12,
}) => {
  const conditions = ['p.is_deleted = FALSE'];
  const values = [];
  const add = (condition, value) => {
    values.push(value);
    conditions.push(condition.replace('?', `$${values.length}`));
  };

  if (search) {
    values.push(search);
    const textSearchIndex = values.length;
    values.push(`%${search}%`);
    const partialSearchIndex = values.length;
    conditions.push(
      `(to_tsvector('simple', coalesce(p.name, '') || ' ' || coalesce(p.brand, '') || ' ' || coalesce(p.description, '')) ` +
      `@@ websearch_to_tsquery('simple', $${textSearchIndex}) OR ` +
      `p.name ILIKE $${partialSearchIndex} OR p.brand ILIKE $${partialSearchIndex})`,
    );
  }
  if (category) add('c.name = ?', category);
  if (brand) add('p.brand ILIKE ?', brand);
  if (minPrice !== undefined && minPrice !== '') add('p.price >= ?', Number(minPrice));
  if (maxPrice !== undefined && maxPrice !== '') add('p.price <= ?', Number(maxPrice));
  if (rating !== undefined && rating !== '') add('p.rating >= ?', Number(rating));
  if (availability === 'in-stock') conditions.push('p.stock > 0');
  if (availability === 'out-of-stock') conditions.push('p.stock = 0');

  const where = conditions.join(' AND ');
  const sortSql = {
    'price-asc': 'p.price ASC, p.id ASC',
    'price-desc': 'p.price DESC, p.id ASC',
    rating: 'p.rating DESC, p.id ASC',
    newest: 'p.created_at DESC, p.id ASC',
    featured: 'p.featured DESC, p.trending DESC, p.created_at DESC',
  }[sort] || 'p.featured DESC, p.trending DESC, p.created_at DESC';
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.min(48, Math.max(1, Number.parseInt(limit, 10) || 12));

  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${where}`,
    values,
  );
  const rows = await query(
    `${productSelect} WHERE ${where} ORDER BY ${sortSql} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, safeLimit, (safePage - 1) * safeLimit],
  );
  const total = countResult.rows[0].total;
  return {
    data: rows.rows.map(normalizeProduct),
    total,
    page: safePage,
    pages: Math.max(1, Math.ceil(total / safeLimit)),
    limit: safeLimit,
  };
};

export const getProduct = async (id) => {
  const result = await query(`${productSelect} WHERE p.id::text = $1 AND p.is_deleted = FALSE`, [id]);
  return result.rowCount ? normalizeProduct(result.rows[0]) : null;
};

export const getProductsByIds = async (ids) => {
  if (!ids.length) return [];
  const result = await query(`${productSelect} WHERE p.id::text = ANY($1::text[]) AND p.is_deleted = FALSE`, [ids]);
  return result.rows.map(normalizeProduct);
};

export const listCategories = async () => {
  const result = await query(
    'SELECT name FROM categories WHERE active = TRUE ORDER BY name',
  );
  return result.rows.map((row) => row.name);
};

export const listRecommendations = async () => {
  const result = await query(
    `${productSelect}
     WHERE p.is_deleted = FALSE AND p.stock > 0
     ORDER BY p.featured DESC, p.trending DESC, p.rating DESC, p.review_count DESC
     LIMIT 6`,
  );
  return result.rows.map((row) => {
    const product = normalizeProduct(row);
    return {
      id: product.id,
      name: product.name,
      brand: product.brand,
      price: product.price,
      image: product.images[0] || '',
      category: product.category,
      rating: product.rating,
    };
  });
};

export const findUserByEmail = async (email) => {
  const result = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return result.rows[0] || null;
};

export const findUserById = async (id) => {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
};

export const searchAiProducts = async ({ keywords = [], category, brand, maxPrice, minRating }) => {
  const conditions = ['p.is_deleted = FALSE', 'p.stock > 0'];
  const values = [];
  if (category) {
    values.push(category);
    conditions.push(`c.name ILIKE $${values.length}`);
  }
  if (brand) {
    values.push(`%${brand}%`);
    conditions.push(`p.brand ILIKE $${values.length}`);
  }
  if (Number.isFinite(maxPrice) && maxPrice > 0) {
    values.push(maxPrice);
    conditions.push(`p.price <= $${values.length}`);
  }
  if (Number.isFinite(minRating) && minRating > 0) {
    values.push(minRating);
    conditions.push(`p.rating >= $${values.length}`);
  }
  const terms = keywords.map((term) => term.trim()).filter((term) => term.length > 1).slice(0, 5);
  if (terms.length) {
    const termConditions = terms.map((term) => {
      values.push(`%${term}%`);
      const index = values.length;
      return `(p.name ILIKE $${index} OR p.brand ILIKE $${index} OR p.description ILIKE $${index} OR c.name ILIKE $${index})`;
    });
    conditions.push(`(${termConditions.join(' OR ')})`);
  }

  const result = await query(
    `${productSelect} WHERE ${conditions.join(' AND ')}
     ORDER BY p.featured DESC, p.trending DESC, p.rating DESC
     LIMIT 10`,
    values,
  );
  return result.rows.map(normalizeProduct);
};
