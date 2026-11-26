CREATE TABLE "trail_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trail_id" uuid NOT NULL,
	"author_id" text,
	"status" "trail_status" DEFAULT 'draft' NOT NULL,
	"position" geography(Point, 4326) NOT NULL,
	"line_fraction" double precision NOT NULL,
	"exif_position" geography(Point, 4326),
	"altitude_m" real,
	"heading" real,
	"taken_at" timestamp with time zone,
	"image_key" text NOT NULL,
	"thumb_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trail_photos" ADD CONSTRAINT "trail_photos_trail_id_trails_id_fk" FOREIGN KEY ("trail_id") REFERENCES "public"."trails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trail_photos" ADD CONSTRAINT "trail_photos_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trail_photos_trail_id_idx" ON "trail_photos" USING btree ("trail_id");--> statement-breakpoint
CREATE INDEX "trail_photos_author_status_idx" ON "trail_photos" USING btree ("author_id","status");