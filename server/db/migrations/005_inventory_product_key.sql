CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_product_unique
  ON inventory (product_id);
