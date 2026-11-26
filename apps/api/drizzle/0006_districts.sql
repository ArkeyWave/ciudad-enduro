-- Districts replace cities (plan §10 L3-1, amendment A4). The three cities map to their INEI codes;
-- any other value would stay NULL and make SET NOT NULL fail, so the migration stops instead of guessing.
ALTER TABLE "trails" ADD COLUMN "ubigeo" char(6);--> statement-breakpoint
UPDATE "trails" SET "ubigeo" = CASE "city"
	WHEN 'Chimbote' THEN '021809'
	WHEN 'Nuevo Chimbote' THEN '021809'
	WHEN 'Trujillo' THEN '130101'
END;--> statement-breakpoint
ALTER TABLE "trails" ADD CONSTRAINT "trails_ubigeo_format" CHECK ("ubigeo" ~ '^[0-9]{6}$');--> statement-breakpoint
ALTER TABLE "trails" ALTER COLUMN "ubigeo" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trails" DROP COLUMN "city";--> statement-breakpoint
ALTER TABLE "trails" DROP COLUMN "department";--> statement-breakpoint
DROP TYPE "public"."city";--> statement-breakpoint
DROP TYPE "public"."department";
