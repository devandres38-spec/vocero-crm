-- 078 (bloque J, D18 de Aliantis) — La etapa por eventos. La primera parte la generó drizzle-kit
-- (la columna, el índice único por negocio y los CHECK de schema.ts); la segunda va escrita a mano.
ALTER TABLE "pipeline_stage" ADD COLUMN "evento_bot" text;--> statement-breakpoint
CREATE UNIQUE INDEX "stage_org_evento_uq" ON "pipeline_stage" USING btree ("organization_id","evento_bot") WHERE "pipeline_stage"."evento_bot" is not null;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "stage_evento_abierta_chk" CHECK ("pipeline_stage"."evento_bot" is null or "pipeline_stage"."kind" = 'open');--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "stage_evento_catalogo_chk" CHECK ("pipeline_stage"."evento_bot" is null or "pipeline_stage"."evento_bot" in ('primera_respuesta', 'servicio_consultado', 'pidio_cita', 'cita_agendada'));--> statement-breakpoint
-- A mano: el mapeo por defecto de los negocios que ya existen, el mismo del alta
-- (ETAPAS_INICIALES): por nombre exacto, solo en etapas abiertas y, si un negocio tiene dos con
-- el mismo nombre, la primera del Pipeline. Un negocio que renombró las suyas queda sin mapeo
-- hasta que lo elija en la pantalla de etapas. Re-ejecutable: no pisa un mapeo que ya exista.
UPDATE "pipeline_stage" s SET "evento_bot" = m.evento
FROM (
  SELECT DISTINCT ON (st."organization_id", e.evento) st."id", e.evento
  FROM "pipeline_stage" st
  JOIN (VALUES ('En conversación', 'primera_respuesta'), ('Interesado', 'servicio_consultado'))
    AS e(nombre, evento) ON st."name" = e.nombre
  WHERE st."kind" = 'open'
    AND NOT EXISTS (
      SELECT 1 FROM "pipeline_stage" o
      WHERE o."organization_id" = st."organization_id" AND o."evento_bot" = e.evento
    )
  ORDER BY st."organization_id", e.evento, st."position"
) m
WHERE s."id" = m."id" AND s."evento_bot" IS NULL;
