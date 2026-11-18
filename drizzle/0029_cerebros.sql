CREATE TABLE "brain_deployment" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"dispatch_url" text NOT NULL,
	"health_url" text,
	"secret_cipher" text NOT NULL,
	"secret_iv" text NOT NULL,
	"secret_tag" text NOT NULL,
	"secret_last4" text NOT NULL,
	"status" text DEFAULT 'activo' NOT NULL,
	"last_health_at" timestamp,
	"last_health_ok" boolean,
	"last_health_detail" jsonb,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_operation" (
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"action" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "brain_operation_organization_id_idempotency_key_pk" PRIMARY KEY("organization_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "brain_reply" (
	"organization_id" text NOT NULL,
	"dispatch_id" text NOT NULL,
	"text_hash" text NOT NULL,
	"message_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "brain_reply_organization_id_dispatch_id_text_hash_pk" PRIMARY KEY("organization_id","dispatch_id","text_hash")
);
--> statement-breakpoint
ALTER TABLE "dispatch" ADD COLUMN "brain_deployment_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "brain_deployment_id" text;--> statement-breakpoint
ALTER TABLE "brain_deployment" ADD CONSTRAINT "brain_deployment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_operation" ADD CONSTRAINT "brain_operation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_reply" ADD CONSTRAINT "brain_reply_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_reply" ADD CONSTRAINT "brain_reply_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_brain_deployment_id_brain_deployment_id_fk" FOREIGN KEY ("brain_deployment_id") REFERENCES "public"."brain_deployment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_brain_deployment_id_brain_deployment_id_fk" FOREIGN KEY ("brain_deployment_id") REFERENCES "public"."brain_deployment"("id") ON DELETE restrict ON UPDATE no action;