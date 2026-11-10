-- Points must fall inside Peru's bounding box (lng -81.4..-68.6, lat -18.4..0.0).
-- A point with swapped axes falls outside it.
ALTER TABLE "trails" ADD CONSTRAINT "trails_start_in_peru" CHECK (
	ST_X("start_point") BETWEEN -81.4 AND -68.6 AND ST_Y("start_point") BETWEEN -18.4 AND 0.0
);--> statement-breakpoint
ALTER TABLE "trails" ADD CONSTRAINT "trails_end_in_peru" CHECK (
	"end_point" IS NULL OR (ST_X("end_point") BETWEEN -81.4 AND -68.6 AND ST_Y("end_point") BETWEEN -18.4 AND 0.0)
);
