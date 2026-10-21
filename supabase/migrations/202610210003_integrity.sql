SET search_path TO gtune,pg_catalog;
ALTER TABLE products ADD CONSTRAINT products_stock_valid CHECK (stock >= 0);
ALTER TABLE products ADD CONSTRAINT products_price_valid CHECK (price >= 0 AND (old_price IS NULL OR old_price > price));
ALTER TABLE coupons ADD CONSTRAINT coupons_usage_valid CHECK (used >= 0 AND (max_uses IS NULL OR max_uses > 0));
ALTER TABLE orders ADD CONSTRAINT orders_totals_valid CHECK (subtotal >= 0 AND discount >= 0 AND discount <= subtotal AND shipping >= 0 AND total = subtotal - discount + shipping);
ALTER TABLE reviews ADD CONSTRAINT reviews_rating_valid CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE payment_sessions ADD CONSTRAINT payment_amount_valid CHECK (amount >= 0 AND currency = 'ron');
