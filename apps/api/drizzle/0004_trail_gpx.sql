CREATE TABLE "trail_sources" (
	"trail_id" uuid PRIMARY KEY NOT NULL,
	"gpx" text NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trail_sources_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
ALTER TABLE "trails" ADD COLUMN "elevation_loss_m" integer;--> statement-breakpoint
ALTER TABLE "trails" ADD COLUMN "elevation_profile" jsonb;--> statement-breakpoint
ALTER TABLE "trail_sources" ADD CONSTRAINT "trail_sources_trail_id_trails_id_fk" FOREIGN KEY ("trail_id") REFERENCES "public"."trails"("id") ON DELETE cascade ON UPDATE no action;