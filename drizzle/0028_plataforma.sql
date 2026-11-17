CREATE TABLE "platform_admin" (
	"user_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "platform_api_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last4" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_api_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "platform_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"organization_id" text,
	"via" text DEFAULT 'sesion' NOT NULL,
	"token_id" text,
	"action" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"platform_user_id" text NOT NULL,
	"level" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"revoked_by" text
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "status" text DEFAULT 'activa' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "suspended_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "modules" jsonb;--> statement-breakpoint
ALTER TABLE "platform_admin" ADD CONSTRAINT "platform_admin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_api_token" ADD CONSTRAINT "platform_api_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grant" ADD CONSTRAINT "support_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grant" ADD CONSTRAINT "support_grant_platform_user_id_user_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_log_org_idx" ON "platform_audit_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "support_grant_org_idx" ON "support_grant" USING btree ("organization_id","expires_at");--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash");