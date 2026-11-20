-- Auditoría 073-B: índice parcial para el conteo anti-flood (`contarDespachos`:
-- despachos de un negocio en las últimas 24 h, sin los descartados). Aditiva y
-- re-ejecutable.
CREATE INDEX IF NOT EXISTS "dispatch_org_created_idx" ON "dispatch" USING btree ("organization_id","created_at") WHERE "dispatch"."status" <> 'descartado';
