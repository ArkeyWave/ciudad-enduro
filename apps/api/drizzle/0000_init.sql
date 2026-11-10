CREATE TYPE "public"."city" AS ENUM('Chimbote', 'Nuevo Chimbote', 'Trujillo');--> statement-breakpoint
CREATE TYPE "public"."department" AS ENUM('Ancash', 'La Libertad');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('facil', 'intermedio', 'dificil');--> statement-breakpoint
CREATE TYPE "public"."trail_status" AS ENUM('draft', 'published', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."trail_type" AS ENUM('descenso', 'cross_country', 'urbano');--> statement-breakpoint
CREATE TABLE "trails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"city" "city" NOT NULL,
	"department" "department" NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"type" "trail_type" NOT NULL,
	"status" "trail_status" DEFAULT 'draft' NOT NULL,
	"start_point" geometry(Point, 4326) NOT NULL,
	"end_point" geometry(Point, 4326),
	"path" geometry(LineString, 4326),
	"distance_m" integer,
	"elevation_gain_m" integer,
	"author_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trails_slug_unique" UNIQUE("slug")
);
