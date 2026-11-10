CREATE TABLE "otp_send_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "otp_send_log_email_hash_created_at_idx" ON "otp_send_log" USING btree ("email_hash","created_at");--> statement-breakpoint
CREATE INDEX "otp_send_log_created_at_idx" ON "otp_send_log" USING btree ("created_at");