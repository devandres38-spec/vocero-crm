CREATE TABLE "aviso_canal" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "aviso_canal_chat_chk" CHECK ("aviso_canal"."telegram_chat_id" ~ '^-?[0-9]{1,20}$')
);
--> statement-breakpoint
CREATE TABLE "aviso_traspaso" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"handoff_at" timestamp NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"notified_at" timestamp,
	"last_followup_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "aviso_traspaso_status_chk" CHECK ("aviso_traspaso"."status" in ('pendiente', 'enviado', 'fallido', 'omitido'))
);
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "client_message_id" text;--> statement-breakpoint
ALTER TABLE "aviso_canal" ADD CONSTRAINT "aviso_canal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aviso_traspaso" ADD CONSTRAINT "aviso_traspaso_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aviso_traspaso" ADD CONSTRAINT "aviso_traspaso_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aviso_traspaso_conv_handoff_uq" ON "aviso_traspaso" USING btree ("conversation_id","handoff_at");--> statement-breakpoint
CREATE INDEX "aviso_traspaso_pendiente_idx" ON "aviso_traspaso" USING btree ("created_at") WHERE "aviso_traspaso"."status" = 'pendiente';--> statement-breakpoint
CREATE UNIQUE INDEX "message_org_client_msg_uq" ON "message" USING btree ("organization_id","client_message_id") WHERE "message"."client_message_id" is not null;