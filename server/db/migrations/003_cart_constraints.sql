CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_items_active_product
  ON cart_items (cart_id, product_id)
  WHERE save_for_later = FALSE;

CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON orders (order_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_order_status
  ON payments (order_id, status);
