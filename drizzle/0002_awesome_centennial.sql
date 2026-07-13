CREATE TABLE "product_availability_periods" (
	"product_id" text NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"deactivated_at" timestamp with time zone,
	"detected_by" text NOT NULL,
	CONSTRAINT "product_availability_periods_product_id_activated_at_pk" PRIMARY KEY("product_id","activated_at")
);
--> statement-breakpoint
CREATE INDEX "product_availability_periods_lookup" ON "product_availability_periods" USING btree ("product_id","activated_at","deactivated_at");
--> statement-breakpoint
-- At most one OPEN period per product. Not expressible in the Drizzle schema, but
-- it is the invariant the whole table rests on: "is this pool listed right now?"
-- must have exactly one answer, and a second open period would silently duplicate
-- every expected-slot count that joins through here.
CREATE UNIQUE INDEX "product_availability_periods_one_open"
  ON "product_availability_periods" ("product_id")
  WHERE "deactivated_at" IS NULL;
--> statement-breakpoint
-- Backfill: one period per existing product, so no product is retroactively
-- "never listed" and every historical hour keeps the denominator it had.
--
--   activated_at   = created_at (the registry's first sighting — the best evidence
--                    we have; it predates this table by design).
--   deactivated_at = NULL for products still listed.
--                    For already-inactive ones: the hour after their last stored
--                    observation, which is the same boundary the hourly sync will
--                    use from now on. Falling back to updated_at when no hourly row
--                    survives (they are pruned at 180 days) — an approximation, and
--                    knowingly so: nothing better exists for records that predate
--                    this migration.
INSERT INTO "product_availability_periods" (product_id, activated_at, deactivated_at, detected_by)
SELECT
  p.id,
  p.created_at,
  CASE
    WHEN p.active THEN NULL
    ELSE GREATEST(
      COALESCE(
        (SELECT date_trunc('hour', max(h.hour)) + interval '1 hour'
           FROM apy_hourly h
          WHERE h.product_id = p.id),
        p.updated_at
      ),
      -- A period must never end before it starts: a product created and delisted
      -- inside the same hour would otherwise produce an inverted interval.
      p.created_at
    )
  END,
  'migration'
FROM products p;
