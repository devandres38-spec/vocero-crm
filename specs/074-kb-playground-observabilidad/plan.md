# Plan: Spec 074 — KB de producción, «Probar mi agente», observabilidad BYOK y Laboratorio v2

**Spec**: [spec.md](spec.md) · **Contrato**: [contracts/brains-074.md](contracts/brains-074.md) · **Tareas**: [tasks.md](tasks.md)

## Verificación local (PC de gama baja)

Sin `next build`, Docker ni Playwright. `[crm]` `npx pnpm@11.5.0 typecheck`,
`npx pnpm@11.5.0 lint`, `npx vitest run --maxWorkers=1 --no-file-parallelism`.
`[nea]` `python -m pytest -q` con las 6 doradas B0. Build y E2E en CI/staging.

## Migraciones (CRM, aditivas y re-ejecutables)

Una sola migración (un único snapshot de drizzle):

| Migración | Contenido |
|---|---|
| `0038_kb_produccion` | `kb_entry`: `title`, `category` (+ CHECK), `enabled`, `pinned`, `sort_order`, índice `(organization_id, enabled, pinned, sort_order)`. `agent_profile.resources jsonb default '[]'`. Tabla `agent_playground_day (organization_id, day, count)` con PK compuesta. Tabla `llm_usage` + CHECK de `source` + índices `(organization_id, created_at)` y `created_at` (purga). |

Re-ejecutable: `CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, y cada CHECK/FK con `DROP CONSTRAINT IF EXISTS` antes de `ADD CONSTRAINT`.

## Bloque 1 — KB `[crm]` + `[nea]`

- `src/lib/kb.ts` (puro): categorías, `ordenarKb`, `renderKb` con título, `estimarTokens`, `resourcesSchema`.
- `src/server/kb.ts`: `kbParaElCerebro(orgId)` (filtra + ordena en SQL) y `recursosDe(orgId)`.
- Rutas: `/api/kb` (POST con campos nuevos), `/api/kb/[id]` (PATCH ampliado), `/api/kb/reorder`, `/api/kb/size` (tokens), `/api/agent/resources` (GET/PUT).
- Consumidores: `/api/bot/profile`, `server/brains/context.ts` (`knowledge[].title`, `resources`), `server/lab/runner.ts`, Blueprint `conocimiento` (exporta/importa los campos nuevos de forma opcional).
- UI: `components/agent/kb-section.tsx` (edición inline, filtros, búsqueda, orden, activar/fijar, barra de tokens) y `components/agent/enlaces-card.tsx`.
- Nea: `app/datos.py::recursos_saneados`, `crm_brains._perfil_desde_contexto` (title + resources), `profile.profile_from_payload` (saneado), `prompt._business_block` (texto de enlaces oficiales). `DELTAS_074` en `tests/test_chasis_dorado.py`. Prueba de prefijo estático común.

## Bloque 2 — Playground `[crm]` (Nea ya tiene `/vocero/ensayo`)

- `src/server/brains/ensayo-ficha.ts`: firmar/leer la ficha (`aliantis-ensayo:v1`, 10 min).
- `requireBrain`: lee `X-Vocero-Ensayo`; `AmbitoCerebro.ensayo?: {conversationId}`. `withBrain` rechaza con 403 `ensayo_solo_lectura` toda ruta que no la declare permitida (`llm`, `agenda/slots`).
- `huecosParaElCerebro(req, org, {ensayo})`: con la conversación sintética, sin buscarla ni registrar oferta.
- `src/server/playground.ts`: `contextoDeEnsayo` (perfil, KB, recursos, llm, módulos, horario, booking vacío si hay agenda), `consumirCupo`/`devolverCupo` (`agent_playground_day`), `urlDeEnsayo(dispatchUrl)`, `ensayar()`.
- `POST /api/agent/playground`, `GET /api/agent/playground` (cupo restante y disponibilidad).
- UI: `components/agent/playground-card.tsx`.
- Ajustes: `metadata.bot.playgroundPerDay` (Blueprint `bot`).

## Bloque 3 — Observabilidad `[crm]`

- `src/server/llm-usage.ts`: `usoDesdeRespuesta` (puro), `registrarUsoLlm` (nunca lanza), `purgarUsoLlmViejo` (lotes), `resumenDeSalud`.
- `pensarPorElCerebro` mide latencia y registra; `source` y `dispatchId` llegan de la ruta (`/api/brains/llm`, `/api/bot/llm`).
- `chatJson` acepta `temperature` y `source`; el juez pasa `0` y `lab`.
- Barrido de webhooks purga `llm_usage` a 90 días.
- `GET /api/agent/health` + `components/agent/salud-bot-card.tsx`.
- `lab-client.tsx`: total dinámico.

## Bloque 4 — `pending_send` ordenado `[nea]`

- `app/sender.py`: conjunto de conversaciones bloqueadas en la pasada; un mensaje reprogramado (fallo transitorio) bloquea a los siguientes de su conversación.
- Nea pone `X-Vocero-Dispatch` en las llamadas al modelo del turno (ContextVar del despacho en curso).

## Orden de despliegue

CRM primero (migración `0038` aditiva; el contexto solo crece), luego Nea.
