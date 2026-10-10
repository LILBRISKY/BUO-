ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sku VARCHAR(120),
  ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trending BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_unique
  ON products (sku)
  WHERE sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_active_created
  ON products (is_deleted, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_products_search
  ON products USING GIN (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(description, ''))
  );

INSERT INTO roles (name)
VALUES ('CUSTOMER'), ('ADMIN'), ('SUPER_ADMIN')
ON CONFLICT (name) DO NOTHING;
