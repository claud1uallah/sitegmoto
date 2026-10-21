-- GTune PostgreSQL schema. No demo products or merchant data are inserted.
CREATE SCHEMA IF NOT EXISTS gtune;
REVOKE ALL ON SCHEMA gtune FROM PUBLIC;
SET search_path TO gtune,pg_catalog;
CREATE TABLE IF NOT EXISTS "addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"payload" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "addresses_user_idx" ON "addresses" ("user_id");
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_id" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "banners" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"href" text DEFAULT '/catalog' NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"subcategories" text DEFAULT '[]' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "coupons" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"value" integer NOT NULL,
	"min_subtotal" integer DEFAULT 0 NOT NULL,
	"max_uses" integer,
	"used" integer DEFAULT 0 NOT NULL,
	"starts_at" text,
	"expires_at" text,
	"active" integer DEFAULT 1 NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "coupons_code_unique" ON "coupons" ("code");
CREATE TABLE IF NOT EXISTS "favorites" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "favorites_user_product_idx" ON "favorites" ("user_id","product_id");
CREATE TABLE IF NOT EXISTS "newsletter" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"consent_at" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_email_unique" ON "newsletter" ("email");
CREATE TABLE IF NOT EXISTS "order_history" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"status" text NOT NULL,
	"actor" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "order_history_order_idx" ON "order_history" ("order_id");
CREATE TABLE IF NOT EXISTS "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"payment_status" text NOT NULL,
	"payment_method" text NOT NULL,
	"shipping_method" text NOT NULL,
	"customer" text NOT NULL,
	"items" text NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"shipping" bigint NOT NULL,
	"total" bigint NOT NULL,
	"coupon_id" text,
	"notes" text DEFAULT '' NOT NULL,
	"awb" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "orders_number_unique" ON "orders" ("number");
CREATE UNIQUE INDEX IF NOT EXISTS "orders_idempotency_key_unique" ON "orders" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "orders_user_idx" ON "orders" ("user_id");
CREATE INDEX IF NOT EXISTS "orders_email_idx" ON "orders" ("email");
CREATE TABLE IF NOT EXISTS "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" text NOT NULL,
	"sent_at" text
);

CREATE TABLE IF NOT EXISTS "products" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"brand" text NOT NULL,
	"sku" text NOT NULL,
	"category" text NOT NULL,
	"subcategory" text NOT NULL,
	"price" bigint NOT NULL,
	"old_price" bigint,
	"stock" integer DEFAULT 0 NOT NULL,
	"image" text NOT NULL,
	"images" text DEFAULT '[]' NOT NULL,
	"badge" text,
	"is_demo" integer DEFAULT 0 NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"description" text NOT NULL,
	"specs" text DEFAULT '{}' NOT NULL,
	"compatibility" text DEFAULT '[]' NOT NULL,
	"variants" text DEFAULT '[]' NOT NULL,
	"popularity" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "products_slug_unique" ON "products" ("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "products_sku_unique" ON "products" ("sku");
CREATE INDEX IF NOT EXISTS "products_category_idx" ON "products" ("category","active");
CREATE INDEX IF NOT EXISTS "products_created_idx" ON "products" ("created_at");
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires_at" bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"rating" integer NOT NULL,
	"body" text NOT NULL,
	"verified" integer DEFAULT 0 NOT NULL,
	"approved" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "reviews_user_product_idx" ON "reviews" ("user_id","product_id");
CREATE TABLE IF NOT EXISTS "settings" (
	"id" text PRIMARY KEY NOT NULL,
	"payload" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "payment_sessions" (
	"order_id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"session_url" text,
	"payment_intent_id" text,
	"status" text DEFAULT 'creating' NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'ron' NOT NULL,
	"expires_at" bigint,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_sessions_session_id_unique" ON "payment_sessions" ("session_id");
CREATE TABLE IF NOT EXISTS "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"order_id" text,
	"outcome" text NOT NULL,
	"created_at" text NOT NULL
);

DO $$ DECLARE r record; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='gtune' LOOP EXECUTE format('ALTER TABLE gtune.%I ENABLE ROW LEVEL SECURITY',r.tablename); EXECUTE format('REVOKE ALL ON gtune.%I FROM PUBLIC',r.tablename); END LOOP; END $$;
