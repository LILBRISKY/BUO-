ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE orders
SET expires_at = created_at + INTERVAL '15 minutes'
WHERE expires_at IS NULL AND payment_status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_orders_pending_expiration
  ON orders (expires_at)
  WHERE order_status = 'PENDING_PAYMENT';
