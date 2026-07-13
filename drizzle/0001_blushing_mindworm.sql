CREATE TABLE "product_display_flags" (
	"product_id" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"flagged_at" timestamp with time zone NOT NULL,
	"last_evaluated_at" timestamp with time zone NOT NULL,
	"last_observed_hour" timestamp with time zone NOT NULL,
	"last_observed_apy_net" double precision,
	"last_observed_tvl_usd" double precision
);
--> statement-breakpoint
CREATE INDEX "product_display_flags_reason" ON "product_display_flags" USING btree ("reason");