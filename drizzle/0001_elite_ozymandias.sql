CREATE TABLE `payment_sessions` (
	`order_id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`session_url` text,
	`payment_intent_id` text,
	`status` text DEFAULT 'creating' NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'ron' NOT NULL,
	`expires_at` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_sessions_session_id_unique` ON `payment_sessions` (`session_id`);--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`order_id` text,
	`outcome` text NOT NULL,
	`created_at` text NOT NULL
);
