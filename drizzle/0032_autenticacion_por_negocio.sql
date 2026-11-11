CREATE TABLE "meta_app" (
	"organization_id" text NOT NULL,
	"canal" text NOT NULL,
	"app_id" text,
	"secret_cipher" text NOT NULL,
	"secret_iv" text NOT NULL,
	"secret_tag" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meta_app_organization_id_canal_pk" PRIMARY KEY("organization_id","canal"),
	CONSTRAINT "meta_app_canal_chk" CHECK ("meta_app"."canal" in ('whatsapp', 'instagram', 'messenger'))
);
--> statement-breakpoint
ALTER TABLE "meta_app" ADD CONSTRAINT "meta_app_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;