CREATE INDEX "brain_operation_created_idx" ON "brain_operation" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "brain_reply_message_idx" ON "brain_reply" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "brain_reply_created_idx" ON "brain_reply" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "dispatch_brain_deployment_idx" ON "dispatch" USING btree ("brain_deployment_id") WHERE "dispatch"."brain_deployment_id" is not null;--> statement-breakpoint
CREATE INDEX "organization_brain_deployment_idx" ON "organization" USING btree ("brain_deployment_id") WHERE "organization"."brain_deployment_id" is not null;--> statement-breakpoint
ALTER TABLE "brain_deployment" ADD CONSTRAINT "brain_deployment_status_ck" CHECK ("brain_deployment"."status" in ('activo', 'pausado'));