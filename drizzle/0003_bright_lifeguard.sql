ALTER TABLE "apy_hourly" ADD COLUMN "last_supply_assets" double precision;--> statement-breakpoint
ALTER TABLE "apy_hourly" ADD COLUMN "last_supply_assets_usd" double precision;--> statement-breakpoint
ALTER TABLE "apy_hourly" ADD COLUMN "last_borrow_assets" double precision;--> statement-breakpoint
ALTER TABLE "apy_hourly" ADD COLUMN "last_borrow_assets_usd" double precision;--> statement-breakpoint
ALTER TABLE "apy_hourly" ADD COLUMN "last_collateral_assets_usd" double precision;--> statement-breakpoint
ALTER TABLE "apy_hourly" ADD COLUMN "last_utilization_rate" double precision;--> statement-breakpoint
ALTER TABLE "apy_hourly" ADD COLUMN "last_asset_price_usd" double precision;