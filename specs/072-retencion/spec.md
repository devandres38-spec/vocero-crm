# 072 — Retención por negocio con borrado diario (bloque E, paso 3.9)

**Estado:** aprobado por Andres (10-nov-2026). Cierra la fase 3. Decisión base: D21 de Aliantis («se borra el contenido de lo que pasa de N días por negocio y se conservan los metadatos que usa Resultados; el cerebro hace lo mismo con sus tablas») y el pilar 4 («retención por cliente, 90 días por defecto, con borrado diario»).

Va **solo** porque borra datos por fecha: un error de signo, de organización o de columna borra lo que no debe y no se recupera.

## Lo verificado en el código (10-nov-2026)

- **Hoy solo se purga `webhook_event`** (`src/server/webhooks/eventos.ts`, `purgar`: procesados a los 7 días y agotados a los 30), desde el barrido del worker cada hora (`PURGA_CADA_MS`). No hay retención por negocio en ninguna otra tabla.
- **Resultados lee de `message`** solo metadatos: `direction`, `origin`, `created_at`, `status`, `error` y la existencia de la fila (`analytics/bot.ts` y `analytics/hygiene.ts`). Nunca `text`. De `contact` lee `ficha` (cobertura de ficha de los contactos **creados** en el periodo), `name`, `source` y `archived_at`; de `booking`, `kind`, `status`, `scheduled_at` e `is_test`; de `ad_attribution`, `headline`, `source_*` e `image_asset_id`. **Conclusión:** las filas de `message` se conservan; se vacía su contenido.
- **La bandeja** pinta el texto cuando el mensaje no tiene adjunto (`message-thread.tsx:560`): un mensaje vaciado se ve como texto fijo.
- **Los adjuntos** solo los referencian `message.media_asset_id` y `ad_attribution.image_asset_id`. `olvidar.ts` ya tiene la regla de «borrar el adjunto que nadie usa, fila y archivo, archivo después del commit».
- **El cerebro** ya tiene `retencion_dias` en la configuración del cliente (`client-config.ts:158`, de 7 a 3650, 90 por defecto), **pero nada lo usa**. Guarda contenido en tres sitios que hoy no se borran nunca:
  - `cerebro.despachos.mensajes` (jsonb): el texto filtrado de cada despacho; los procesados se quedan para siempre;
  - `cerebro.conversation_turns.commands`, `validation` y `acciones`: lo que eligió el LLM y los textos que mandó a Vocero (pueden llevar el nombre o los datos de la cita);
  - `cerebro.conversaciones.pending`: lo que el turno va recogiendo (`guardar_*`).
  `llm_calls` no tiene texto (solo tokens, costo y modelo) y `mensajes_leidos` solo ids. Las tareas de pg-boss solo llevan ids. El barredor (cada minuto, cola `exclusive`) lista conversaciones de todos los negocios con una función `SECURITY DEFINER` que devuelve solo ids (migraciones 0002 y 0004): el mismo patrón sirve para la retención.

## Riesgo de cada paso

| Paso | Riesgo | Sabotajes |
| --- | --- | --- |
| T2 Migración y el número de días | Medio (migración aditiva sobre datos) | — (prueba de migración sobre datos en `e2e.yml`) |
| T3 Retención de Vocero | **Crítico** (borrado por fecha, aislamiento) | 4 |
| T2b `loss_note` filtrada | Bajo (privacidad, mismo patrón del 3.6) | 1 |
| T4 Retención del cerebro | **Crítico** (borrado por fecha, aislamiento, turno en curso) | 3 |
| T5 E2E sobre Postgres real | — | — |

## Decisiones

- **D1. Dónde vive N en Vocero.** Columna `privacy_profile.retencion_dias` (entero, 90 por defecto, de 7 a 3650 como en el cerebro), **fuera de la huella** como `adjuntos` (070). La fija `pnpm privacidad:sembrar -- … --retencion <dias>`, que la imprime en su resumen. Un negocio sin perfil usa 90. El número del cerebro sigue en su `cliente.yaml`: en el alta se pone el mismo en los dos (el formato del perfil exportado, contrato compartido con huella, **no cambia**).
- **D2. El corte** es el instante `ahora − N días`, igual para todo el negocio. No se usa la zona horaria: unas horas de diferencia no cambian la obligación y simplifican la prueba de reloj.
- **D3. Qué se vacía en Vocero** (por negocio, lo anterior al corte):

  | Tabla | Fecha que cuenta | Qué pasa |
  | --- | --- | --- |
  | `message` | `created_at` | `text` → `[mensaje borrado por antigüedad]`; `buttons` → NULL; `media_asset_id` → NULL. La fila y sus metadatos se quedan (`direction`, `origin`, `type`, `status`, `error`, `ai_generated`, `privacy_flags`, `button_id`, `wa_message_id`, `client_message_id`, fechas). |
  | `media_asset` | — | Los que dejaron de usarse por el paso anterior, y los huérfanos más viejos que el corte: fila y archivo. Nunca la imagen de una tarjeta de anuncio. |
  | `conversation_note` | `created_at` | Se borra la fila. |
  | `booking` | la mayor entre `created_at` y `scheduled_at` | `notes` → NULL. |
  | `lead_stage_event` | `occurred_at` | `loss_note` → NULL (el motivo de pérdida se queda). |
  | `contact` | la última actividad: el mayor `last_message_at` de sus conversaciones, o `updated_at` si no tiene | `notes` y `ficha` → NULL (aprobado: la cobertura de ficha de Resultados refleja solo los últimos N días). El nombre, el teléfono y la identidad se quedan. |
  | `agent_test_case` | `created_at` | `transcript` y `hallazgos` → NULL. |
  | `webhook_event` | `created_at` | Se borra la fila, en cualquier estado (la purga global de 7 y 30 días sigue igual). |

  **Se conservan sin cambios:** la conversación, el lead y sus etapas, la tarjeta del anuncio, `consent` (la prueba del consentimiento), `conversion_event`, `dispatch` (solo ids y estado), `aviso_traspaso`, `olvido_pendiente` (solo ids), `offered_slot` (solo horarios) y lo del negocio (`kb_entry`, `quick_reply`, `template`).
- **D4. Cómo corre en Vocero.** `aplicarRetencion(ahora)` en `src/server/retencion/`, llamado desde el barrido del worker de webhooks una vez cada 24 horas (y en el primer barrido tras arrancar: es idempotente). Por negocio, en tandas de 500 filas por transacción, con `pg_try_advisory_xact_lock` por negocio para que dos instancias no trabajen el mismo a la vez; si el candado está tomado, ese negocio se salta hasta la siguiente vuelta. Los archivos se borran después del commit. El registro solo dice cuántas filas por negocio, nunca contenido. No publica eventos SSE (son mensajes viejos).
- **D5. Qué se borra en el cerebro** (por negocio, con su `retencion_dias`):
  - `despachos` procesados con `received_at` anterior al corte: se borra la fila (los pendientes nunca);
  - `conversation_turns` con `created_at` anterior al corte y `outcome` distinto de `en_curso`: se borra la fila (un turno a medias es un punto de control y el barredor lo necesita);
  - `conversaciones` con `updated_at` anterior al corte: `pending` → NULL (la fila se queda: `derivada_at` y `bot_desde` siguen valiendo);
  - `mensajes_leidos` con `read_at` anterior al corte: se borra la fila;
  - `llm_calls` y `tenant_configs` se conservan (sin texto; cuentan para el gasto).
- **D6. Cómo corre en el cerebro.** Migración `0006` con `cerebro.organizaciones_con_configuracion()` (`SECURITY DEFINER`, devuelve solo ids, como 0002 y 0004). Cola nueva `retencion` (`exclusive`), programada con `boss.schedule('retencion', '0 3 * * *', …, { tz: 'America/Bogota' })`. Cada negocio, dentro de `withOrganization` (con RLS), lee su última configuración y borra.
- **D8. `loss_note` por el filtro al escribir** (hallazgo de este bloque, aprobado): la nota de pérdida del pipeline (`PATCH /api/pipeline/leads/[id]` → `leads/stage-history.ts`) se guardaba sin filtrar; el 3.6 la dejó fuera. Pasa por `filtrarTextoLibre` como las demás notas.
- **D7. El texto fijo** `RETENTION_TEXT = "[mensaje borrado por antigüedad]"` vive en `src/server/retencion/aplicar.ts` (no en `privacy-filter.ts`, que es copia del cerebro y no se edita a mano). `GET /api/bot/history` lo entrega tal cual: el cerebro no lo confunde con texto del paciente porque no pide historial más viejo que su propia retención.

## Modelo de datos

**Vocero, `0031_retencion.sql`:**
- `privacy_profile.retencion_dias integer not null default 90`, con `check (retencion_dias between 7 and 3650)`. Las filas existentes quedan en 90.
- Índice `message_org_created_idx (organization_id, created_at)`: la búsqueda diaria por negocio y fecha no tiene hoy un índice que empiece así (el actual es `organization_id, conversation_id, created_at`).

**Cerebro, `0006_retencion.sql`:** la función `cerebro.organizaciones_con_configuracion()` con `REVOKE … FROM PUBLIC` y `GRANT EXECUTE … TO cerebro_app`. Sin columnas nuevas.

## Archivos

**Vocero**
- `drizzle/0031_retencion.sql`, `src/lib/db/schema.ts`.
- `src/server/retencion/aplicar.ts` (nuevo): `aplicarRetencion(ahora)`, `retencionDe(org)`, `vaciarNegocio(org, corte)`.
- `tests/unit/fixtures/base-grabadora.ts`: `execute` (el candado por negocio).
- `src/server/privacy/repositorio.ts`: leer y guardar `retencion_dias`.
- `scripts/privacidad-sembrar.ts`: `--retencion <dias>`.
- `src/server/webhooks/worker.ts`: la llamada cada 24 horas.
- `src/app/api/dev/retencion/route.ts` (nuevo, solo con mocks, 404 en producción): corre una pasada con un `ahora` dado, para el E2E.
- `scripts/e2e-retencion.mjs` (nuevo), `tests/e2e/us-retencion.md`, `.github/workflows/e2e.yml` (un paso más).
- `tests/unit/retencion.test.ts` (nuevo).
- `AGENTS.md` (fila `retencion/`), `docs/openapi.json` (nota en `history` sobre el texto fijo).

**Cerebro**
- `drizzle/0006_retencion.sql` y su registro en `src/db/migrations.ts`.
- `src/retencion/aplicar.ts` (nuevo).
- `src/queue/conversation-queue.ts` (cola `retencion`) y `src/queue/worker.ts` (programación diaria).
- `test/unit/retencion.test.ts` y `test/integration/retencion.test.ts` (con Postgres del CI).

## Casos borde

1. **Dos negocios, N distintos** (7 y 90): un mensaje de 10 días se vacía en el primero y no en el segundo.
2. **El corte exacto:** un mensaje con `created_at` igual al corte no se toca (`<` estricto).
3. **Idempotencia:** la segunda pasada no cambia nada (filtra por «todavía tiene contenido») y los conteos de Resultados son los mismos antes y después.
4. **Un adjunto compartido** por un mensaje viejo y uno reciente (reenvío) no se borra; uno usado por la tarjeta del anuncio tampoco.
5. **El archivo no se puede borrar del volumen:** la fila ya no existe; se registra cuántos fallaron y la próxima pasada no lo vuelve a intentar (mismo criterio que `olvidar.ts`).
6. **Un negocio sin perfil de privacidad:** 90 días.
7. **Una cita futura agendada hace más de N días:** conserva sus notas hasta que pase.
8. **Un contacto viejo que vuelve a escribir:** su ficha se queda (la última actividad es reciente).
9. **El Laboratorio** (`is_test`) sigue la misma regla.
10. **Dos instancias de Vocero:** el candado por negocio evita el trabajo doble; si choca, se salta.
11. **Cerebro:** un turno `en_curso` viejo no se borra; un despacho pendiente viejo tampoco.
12. **Cerebro, negocio sin configuración legible:** se salta y se registra (no se adivina N).
13. **Una tanda falla a la mitad:** la transacción se deshace entera; la próxima pasada la retoma.

## Sabotajes (8)

Vocero:
1. Quitar el filtro por negocio en el `update` de `message` → falla la prueba de aislamiento.
2. Invertir el corte (`>` en vez de `<`) → falla la prueba de reloj.
3. Borrar las filas de `message` en vez de vaciarlas → falla la prueba de «Resultados cuenta igual».
4. Quitar la protección del adjunto de la tarjeta del anuncio → falla su prueba.

8. `loss_note` sin filtrar → falla su prueba.

Cerebro:
5. Borrar también los turnos `en_curso` → falla la prueba de integración.
6. Usar 90 fijo en vez de `retencion_dias` → falla la de dos negocios.
7. Correr fuera de `withOrganization` → falla la de aislamiento (RLS).

## Verificación

- **En el PC:** `vitest run` de los archivos tocados, los sabotajes 1 a 4, prettier y eslint de lo tocado, `tsc --noEmit` y `pnpm db:generate` (Vocero); en el cerebro, las unitarias tocadas y su `tsc`.
- **En el CI:** Vocero completo (las dos configuraciones); cerebro completo, con sus pruebas de integración y los sabotajes 5 a 7 comprobados ahí.
- **`e2e.yml`** (etiqueta `e2e`): los tres arneses de siempre, la migración sobre datos (0031 con perfiles existentes) y el nuevo `e2e-retencion.mjs`: siembra dos negocios con filas viejas y nuevas directo en Postgres, corre la pasada por la ruta de desarrollo y comprueba fila a fila qué se vació, qué quedó y que los conteos de Resultados no cambian. Es el que atrapa errores de SQL real como el del bloque D.

## Lo que esta spec no hace

- No cambia el formato del perfil exportado ni su huella.
- No borra contactos, conversaciones ni leads (eso es la supresión a pedido del titular, otro paso).
- No toca `llm_calls`: no tiene texto y es la base del tope de gasto.
- No agrega una pantalla para cambiar N: lo fija Andres en el alta (el panel de Andres es la fase 4).
