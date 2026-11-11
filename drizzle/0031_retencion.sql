ALTER TABLE "privacy_profile" ADD COLUMN "retencion_dias" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
CREATE INDEX "message_org_created_idx" ON "message" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "privacy_profile" ADD CONSTRAINT "privacy_profile_retencion_chk" CHECK ("privacy_profile"."retencion_dias" between 7 and 3650);