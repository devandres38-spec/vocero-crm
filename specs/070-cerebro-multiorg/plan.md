# Implementation Plan: Cerebro multi-organización (`/api/brains/*`)

**Spec**: [spec.md](spec.md) · **Contrato**: [contracts/brains.md](contracts/brains.md)
**Branch**: `feat/070-cerebro-multiorg` · **Versión objetivo**: vocero-crm
**2.10.0** (aditiva) · nea-agent: parche menor (D3).

## Contexto técnico

Next.js 15 · TypeScript estricto · Drizzle/PostgreSQL · Zod 4 · Vitest con fake
DB. Reutiliza: `src/server/brains/contract.ts` (evento, firma),
`src/server/brains/deliver.ts` (`entregar`, `avisarOlvido`),
`src/server/dispatch/*` (outbox, worker, lease, reintentos),
`src/server/bot/*` (ficha, stage, handoff, profile, llm-proxy), las rutas
`/api/bot/*` como núcleo de lógica, `src/lib/crypto` (AES-256-GCM),
`src/lib/rate-limit.ts`, `src/server/platform/auditoria.ts`,
`src/server/modulos/` (módulo agenda efectivo por organización).

Verificación local (equipo modesto): `typecheck`, `lint`, Vitest con 1 worker,
`pytest` en nea-agent. Build y E2E (`e2e-cerebro` con una Nea `multiorg` real)
en CI/staging.

## Decisiones técnicas (para aprobar)

- **D1 — Un despliegue, N negocios; asignación 0..1 por negocio.**
  `brain_deployment` + `organization.brain_deployment_id`. Es exactamente el
  modelo de `app/multiorg.py` (un secreto por despliegue que firma todo y
  deriva credenciales). Varios cerebros por negocio: fuera de alcance.

- **D2 — Secreto maestro generado por el CRM, cifrado (no hasheado).** El CRM
  lo necesita en claro para firmar despachos y derivar credenciales, así que va
  con `encryptSecret` (AES-256-GCM, `ENCRYPTION_KEY`) y solo `secretLast4` en
  claro. Se muestra una vez al crear/rotar (patrón de tokens `alp_`). Opción
  «pegar secreto existente» para una Nea ya desplegada (mín. 32 caracteres).
  Rotar invalida en el acto (caché de 60 s purgada en el proceso).

- **D3 — Hueco en Nea: `move_stage` en cloud sale a `/api/bot/stage`.**
  `BrainsCrmClient.RUTAS` no mapea `/api/bot/stage`; en `multi` esa ruta es
  404 y el agente nunca movería etapas. Corrección: el CRM publica
  `POST /api/brains/stage` **y** Nea añade una línea a `RUTAS`
  (`"/api/bot/stage": "/api/brains/stage"`) + prueba gemela, en su rama
  `feat/070-cerebro-multiorg`. Alternativa descartada: aceptar credencial de
  cerebro en `/api/bot/stage` (rompe «`/api/bot/*` = 404 en `multi`»).
  No se tocan contratos existentes: es aditivo en ambos lados.

- **D4 — `requireBrain` único, 401 uniforme, sin oráculo.** Slug **o** id en
  `X-Vocero-Organization` (Nea manda el id si no hay slug). Mismo limitador
  por IP que los tokens `alp_` (F-04). Suspendida → 403 tras autenticar.
  En `single`, `/api/brains/*` es 404 vacío.

- **D5 — Lógica compartida, no duplicada.** Cada handler de `/api/bot/*` se
  parte en «autenticación» + «núcleo puro con `organizationId`»
  (`src/server/bot/nucleo/*`). `/api/bot` y `/api/brains` llaman al mismo
  núcleo; solo difieren autenticación, `context` (añade `agent`/`knowledge`/
  `llm`, exige `conversationId`), `messages` (exige `dispatchId`, 201, 422
  `fuera_de_ventana`) y la forma de `book` (`{ok, booking}`). El cuerpo y las
  expectativas de `/api/bot/*` no cambian (SC-001).

- **D6 — IA solo con la llave del negocio.** `/api/brains/llm` y `context.llm`
  usan `resolveAiProvider(org)` exigiendo `source: "org"`; el respaldo
  `OPENROUTER_*` del entorno queda prohibido en esta superficie (si no, el
  dueño de la plataforma pagaría el consumo de todos los negocios — la regla
  dura de Nea). `transcribeModel` = modelo de Ajustes → IA si declara audio,
  si no `""` (Nea no transcribe antes que alucinar).

- **D7 — Agenda v1 anunciada; v2 construida pero sin anunciar.** Nea activa
  `agenda_v2` solo si el despacho trae `capabilities:["agenda_v2"]`, y con ella
  le promete **recordatorios** al cliente. El CRM no tiene recordatorios de
  citas, así que 070 **no** anuncia `agenda_v2`: Nea usa `slots` + `book`
  POST/PATCH y la cancelación va a humano (como hoy). `bookings` y `cancel` se
  implementan con la forma v2 (`selectionToken`, `idempotencyKey`,
  `confirmation`) y pruebas, listos para encenderse cuando existan los
  recordatorios (071+). `brainGeneration` no se emite: su función (rechazar
  respuestas de un cerebro viejo) la cumple `dispatch.brain_deployment_id`
  → 409 `cerebro_reasignado`.

- **D8 — `followup` dormido.** `agent.coordinationFollowupEnabled` = `false`
  siempre en 070; la ruta existe y responde 409 `followup_not_allowed`. El
  seguimiento durable de coordinación es una feature propia.

- **D9 — Ensayo diferido.** `POST {nea}/vocero/ensayo` + ficha
  `X-Vocero-Ensayo` sirve para probar sin conversación. El Laboratorio actual
  ya funciona en `multi` despachando conversaciones `is_test` al cerebro
  asignado (Nea marca `prueba`), así que el ensayo no bloquea nada. Se difiere
  a la 071; la cabecera se ignora si llega.

- **D10 — Despacho: mismo outbox, destino por fila.** `despachoActivo()`
  deja de ser global en `multi`: `destinoDe(organizationId)` →
  `{url, secret, deploymentId} | null` (negocio activo + despliegue asignado y
  activo). `despacharAlCerebro` mantiene sus candados (`ai_enabled`,
  `handoff_at`, `agent_profile.enabled`, suspendida) y añade «tiene destino».
  El worker resuelve el destino **al entregar** (no al encolar) y lo anota en
  `dispatch.brain_deployment_id`. `expiresAt` = `createdAt + vida máxima`
  (la misma que hoy lleva a `caducado_a_humano`), solo en `multi`.

- **D11 — Encender el agente en `multi`.** El interruptor exige hoy `/health`
  sano del cerebro global; en `multi` exige un despliegue asignado, activo y
  con la última salud `ok` (409 `sin_cerebro` si no). La tarjeta «Quién
  responde» muestra el nombre del despliegue (sin URL ni secreto al dueño).

- **D12 — Panel, Blueprint y MCP sin secretos.** Panel: `/platform/cerebros`
  (lista, crear, probar, rotar, pausar/reactivar) + selector en la ficha y en
  la pestaña «Agente» del `FormularioBlueprint`. Blueprint v1 aditivo:
  `brain?: { deployment: string } | null`. MCP: `list_brain_deployments`
  (id, nombre, host, estado, salud, nº de negocios) y `get_organization` con
  `brain`. Crear/rotar solo en el panel (el secreto no debe pasar por una IA).
  REST: `GET /api/platform/brains` (lectura).

- **D13 — Salud con salvaguardas.** Solo Super-Admin; URL http(s) sin
  credenciales; `redirect: "manual"`; timeout 5 s; se leen como mucho 4 KB y
  solo `version`, `mode`, `llm`. Se permiten hosts internos (`http://nea:8000`)
  porque los registra el operador de la plataforma, igual que
  `BRAIN_DISPATCH_URL` en `single`.

## Migración `0029_cerebros` (aditiva, re-ejecutable)

```sql
CREATE TABLE IF NOT EXISTS brain_deployment (
  id text PRIMARY KEY,                       -- brn_…
  name text NOT NULL,
  dispatch_url text NOT NULL,
  health_url text,                           -- null = {origen}/health
  secret_ciphertext text NOT NULL,           -- encryptSecret (iv:tag:data)
  secret_last4 text NOT NULL,
  status text NOT NULL DEFAULT 'activo',     -- activo | pausado
  last_health_at timestamp,
  last_health_ok boolean,
  last_health_detail jsonb,                  -- {version, mode, llm, status}
  created_by text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE organization ADD COLUMN IF NOT EXISTS brain_deployment_id text
  REFERENCES brain_deployment(id) ON DELETE RESTRICT;
ALTER TABLE dispatch ADD COLUMN IF NOT EXISTS brain_deployment_id text
  REFERENCES brain_deployment(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS brain_reply (       -- idempotencia de /messages
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  dispatch_id text NOT NULL,
  text_hash text NOT NULL,
  message_id text NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, dispatch_id, text_hash)
);
CREATE TABLE IF NOT EXISTS brain_operation (   -- idempotencia de agenda v2
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  action text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS organization_brain_idx ON organization(brain_deployment_id);
```

En `single` las tablas existen vacías y nada las lee. Purga: `brain_reply` y
`brain_operation` > 7 días, en el mismo barrido del worker.

## Estructura

```
src/server/brains/
  deployment.ts      # CRUD, cifrado, caché, credencialDerivada(), destinoDe()
  salud.ts           # probarSalud() con D13
  auth.ts            # requireBrain() → {organizationId, deploymentId, slug}
  context.ts         # cuerpo de /context (bot + agent + knowledge + llm)
  seleccion.ts       # selectionToken firmar/leer
  idempotencia.ts    # brain_reply / brain_operation
src/server/bot/nucleo/  # lógica compartida extraída de /api/bot (D5)
src/app/api/brains/{context,messages,ficha,stage,handoff,typing}/route.ts
src/app/api/brains/media/[mediaId]/route.ts
src/app/api/brains/llm/[...ruta]/route.ts
src/app/api/brains/agenda/{slots,book,bookings,cancel,followup}/route.ts
src/app/(platform)/platform/cerebros/page.tsx + componentes
src/app/api/platform/brains/… (panel: CRUD con sesión; REST: lectura)
docs/openapi-brains.json · docs/plataforma-cerebro.md
```

## Fases

| Fase | Contenido | Historias | Depende de |
|---|---|---|---|
| **F0** Base | Migración `0029`, esquema Drizzle, `deployment.ts` (cifrado, `credencialDerivada` + vector gemelo), auditoría nueva | — | — |
| **F1** Despliegues | Servicio + `/platform/cerebros` + probar salud + rotar/pausar + asignación en ficha y formulario | US1, US2 | F0 |
| **F2** Autenticación | `requireBrain`, caché, 401 uniforme, limitador, 404 en `single`, guardia estática | US3 | F0 |
| **F3** Núcleo compartido | Extraer `src/server/bot/nucleo/*` sin cambiar `/api/bot/*` (suite intacta) | — | — |
| **F4** Superficie | `context`, `messages` (+ idempotencia), `ficha`, `stage`, `handoff`, `typing`, `media`, `llm` | US5 | F2, F3 |
| **F5** Despacho | `destinoDe`, worker por fila, `expiresAt`, olvido por organización, interruptor y tarjeta (D11), Laboratorio en `multi` | US4 | F1, F2 |
| **F6** Agenda | `slots` (404 vacío/sonda), `book` POST/PATCH, `bookings`, `cancel`, `followup` | US6 | F4 |
| **F7** Blueprint/MCP/REST | `brain` en Blueprint, `list_brain_deployments`, `GET /api/platform/brains`, docs OpenAPI | US2 | F1 |
| **F8** Aislamiento y gemelas | Matriz `A ↛ B` por endpoint, vectores gemelos CRM; rama Nea (D3 + `test_brains_gemelo.py`) | US7 | F4–F6 |
| **F9** Cierre | Docs, `.env.example` (nada nuevo obligatorio), 2.10.0, CHANGELOG, gate local; CI/staging con Nea `multiorg` real | — | todo |

Entrega en bloques como la 069, con verificación ligera y commit por fase:
**Bloque 1** F0–F3 · **Bloque 2** F4–F5 · **Bloque 3** F6–F9.

## Riesgos

- **Fuga entre negocios** (crítico): mitigado por ámbito único de
  `requireBrain`, `scoped()`, matriz `A ↛ B` y guardia estática.
- **Costo de IA mal atribuido**: D6 + prueba que espía el `fetch` del proxy.
- **Doble envío**: `dispatchId` validado + `brain_reply`.
- **Divergencia entre repos**: vectores gemelos en ambos lados (SC-004).
- **Rotación con despachos en vuelo**: caen a humano tras reintentos; el panel
  lo advierte antes de rotar.
