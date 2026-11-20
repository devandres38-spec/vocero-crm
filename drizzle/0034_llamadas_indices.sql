-- 072-B (auditoría M-1, B-3): aditiva sobre 0033, que ya corre en staging.
-- Re-ejecutable. El índice evita un barrido completo de `brain_tool_call`
-- cada vez que se borra una conversación (FK con ON DELETE CASCADE); el CHECK
-- refuerza en la base que una llamada `hecha` siempre guarda su respuesta.
CREATE INDEX IF NOT EXISTS "brain_tool_call_conv_idx" ON "brain_tool_call" USING btree ("conversation_id");--> statement-breakpoint
ALTER TABLE "brain_tool_call" DROP CONSTRAINT IF EXISTS "brain_tool_call_hecha_ck";--> statement-breakpoint
ALTER TABLE "brain_tool_call" ADD CONSTRAINT "brain_tool_call_hecha_ck" CHECK ("brain_tool_call"."estado" <> 'hecha' or "brain_tool_call"."response" is not null);
