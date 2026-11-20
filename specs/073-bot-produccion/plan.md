# Plan: Bot de Producción (073)

**Spec**: [spec.md](spec.md) · **Contrato**: [contracts/brains-073.md](contracts/brains-073.md) · **Tareas**: [tasks.md](tasks.md)

## 1. Decisiones técnicas

| # | Decisión | Descartado |
|---|---|---|
| **D1** (073-B) | Helper de pausa compartido (`manual_reply`) en `sendText` de la Bandeja; `humanGap` aditivo en el contexto; Nea lo inyecta una vez sin guardarlo. | Leer siempre todo el hilo del CRM; webhook de mensajes humanos hacia Nea. |
| **D2** | **073-A:** ronda final sin herramientas al agotar `MAX_TOOL_ROUNDS`; reintento de respuesta inválida sin herramientas; `temperature` 0.4; errores 400/401/402/403/422 terminales con causa tipada (`LlmRechazado`); 429/5xx con jitter y `Retry-After`; `post_handoff` con 3 intentos + cola durable; motivos `sin_saldo`, `opt_out`, `abuso`. **073-B:** `summary` + nota interna; filtro «Atención humana». | Subir `MAX_TOOL_ROUNDS`; `temperature` 0; failover de modelo propio. |
| **D3** | Outbox 6 intentos, espera 2/5/15/45/120 s (+30 % jitter); caducar = `bot_incident` + nota, **sin** `pasarAHumano`; pool de 4 carriles con tope 2 por organización (reclamo serializado); cierre ordenado de Nea + reanudación sin efectos; `envio_permanente` (422) vs `meta_unavailable` (503); `pending_send` 15 min; `sendText` persiste `failed`. | Solo alargar backoff; un worker por organización; 24 h de `pending_send`. |
| **D4** (073-B) | Delimitación y saneado de datos no confiables; anti-flood en `encolar.ts` sobre la tabla `dispatch`; topes en Blueprint. | `rate-limit.ts` en memoria; presupuesto en Nea. |
| **D5** (073-C) | Ver spec §6. | OCR de comprobantes; descripción de imagen por llamada extra. |
| **D6** (073-B/C) | Ver spec §5–§6. | Resumen por LLM; opt-out solo por LLM. |
| **D7** (073-C) | Validador post-turno determinista (+ `<think>`); localización vía `DELTAS_073`. | Segundo LLM juez por turno. |
| **D10** | Contratos aditivos; migraciones re-ejecutables; dorados B0 congelados + `DELTAS_073`. | Regenerar dorados. |

## 2. Arquitectura de 073-A

### 2.1 Nea (`nea-agent`)

**Bucle de herramientas** (`app/turn.py`)
- `_tool_loop(..., herramientas=True)`. Al agotar `MAX_TOOL_ROUNDS`, se añade una nota de sistema («responde ya, sin herramientas») y se hace una última llamada con `tools=None`. `None` solo si esa llamada tampoco trae texto.
- Tras `_tool_loop`, `final_text is None` (o vacío) **sin** handoff del runtime → handoff `error` (antes: silencio). Si el runtime ya decidió handoff, se respeta.
- El reintento de `_respuesta_invalida` llama `_tool_loop(..., herramientas=False)`.
- `LlmExhausted` → motivo = `exc.motivo_handoff` (`sin_saldo` para 402; `error` en lo demás).

**LLM** (`app/llm.py`)
- `LlmRechazado(LlmExhausted)` con `status` y `causa` (`sin_saldo` 402, `credencial` 401/403, `peticion_invalida` 400/422). Se lanza sin reintentar.
- Orden de decisión ante un `APIStatusError`: visión → `ImagenNoSoportada`; 400 que nombra extras/`temperature` → se apagan 1 h y se reintenta; 400/401/402/403/422 → `LlmRechazado`; 429/5xx/sin status → reintento con `2**intento + U(0, 0.5·base)` o `Retry-After` (≤10 s).
- `temperature`: `LLM_TEMPERATURE` (default 0.4) → `OpenAiLlm(temperature=…)`; en multi-organización, `config["temperature"]` del CRM si viene; en «piensa por el CRM», `profile.llm_temperature` si viene. Se manda solo mientras los extras estén encendidos.

**Handoff resiliente** (`app/turn.py`, `app/sender.py`, `app/crm.py`)
- `_safe_handoff`: 3 intentos (1 s, 2 s) ante `CrmError` no terminal; agotado → `enqueue_pending_handoff` (fila de `pending_send` con `kind='handoff'`, `content=motivo`). `CrmRechazo` no se encola.
- `SenderWorker`: `kind='handoff'` → `post_handoff`; vive 24 h. `kind='message'` → vive `PENDING_SEND_MAX_MINUTES` (15); al caducar, abandonado + handoff `error`. Un `CrmError` con status 400/404/413/422 es terminal: abandonado + handoff `error`.
- `HANDOFF_REASONS` += `sin_saldo`, `opt_out`, `abuso`; `canonical_handoff_reason` los reconoce. El catálogo de la herramienta `escalar` que ve el modelo **no** cambia.

**Envío** (`app/turn.py::_send`)
- `CrmError` con `status` en {400, 404, 413, 422} → terminal: ni reintento ni `pending_send`; el turno registra handoff `error`.
- `CrmError` lleva `status` (opcional) desde `crm.py`/`crm_brains.py`.

**Cierre ordenado y reanudación** (`app/main.py`, `app/dispatch_worker.py`, `app/dispatch_store.py`, `app/efectos.py`)
- `AppContext.apagando: asyncio.Event`. En el `finally` del lifespan: `apagando.set()`, se espera al worker de despacho hasta `NEA_SHUTDOWN_GRACE_SECONDS` (25) y luego se cancela todo.
- Los consumidores no reclaman con `apagando` puesto.
- Migración `010_reanudacion.sql`: `dispatch_inbox.attempts int default 0`, `dispatch_inbox.effects_at timestamptz`, `pending_send.kind text default 'message'`.
- El reclamo incrementa `attempts` y devuelve `attempts` y `effects_at`. `DispatchJob.mark_effects()` escribe `effects_at` (una vez).
- `app/efectos.py`: `ContextVar` con el marcador del turno. `_send`, `ToolRuntime.execute` y `_safe_handoff` llaman `await marcar_efecto()` ANTES del efecto (pesimista).
- `_atender`: `recovery` + `effects_at IS NULL` + `attempts ≤ 3` + no vencido → **reanuda** (`_procesar(..., reanudacion=True)`); en otro caso handoff como hoy.
- Reanudación: sin el filtro de mensajes ya leídos y sin volver a guardar el mensaje del lead si ya es el último del historial con el mismo `wa_message_id`.

### 2.2 CRM (`vocero-crm`)

**Outbox y worker** (`src/server/dispatch/outbox.ts`, `worker.ts`)
- `MAX_INTENTOS = 6`; `BACKOFF_MS = [2000, 5000, 15000, 45000, 120000]` (~3 min de espera + timeouts de 20 s < 10 min de vida).
- `tomarPendientes(limite, ahora, excluirOrgs = [])`.
- `tanda()`: 4 carriles en paralelo que comparten un contador por organización (`MAX_POR_ORG = 2`) y un candado de reclamo (cadena de promesas). Hasta `POR_TANDA` despachos por tanda.
- Donde antes `pasarAHumano(org, conv)` tras caducar: `avisarCaidaDelCerebro({org, conv, detalle})` = `bot_incident` `despacho_caducado` (agrupado por conversación y hora) + nota interna del sistema. `aiEnabled` no se toca. `pasarAHumano` queda exportada (sin llamadores en el worker).

**Gate de saldo** (`src/server/dispatch/encolar.ts`)
- En plataforma: `resolveAiProviderDeOrganizacion(org)`; si `!ok` → `registrarIncidente({kind: motivo === "sin_configurar" ? "sin_credencial" : "sin_saldo", clave: kind + hora})` y no encola.

**Entrega saliente** (`src/server/inbox/send.ts`, `src/server/bot/nucleo/mensajes.ts`, `src/server/brains/respuestas.ts`)
- `SendError.metaCode?: number | null` (de `MetaApiError.code`).
- `sendText`: fallo del canal (`meta_error`, `meta_unavailable`, `reconnect_required`…) → `persistOutbound({status: "failed", error})` y el `SendError` lleva `messageId`. Los fallos de validación previos (`text_too_long`, ventana, sandbox) no persisten nada (como hoy).
- `responderComoCerebro`: `meta_unavailable` → código nuevo `canal_no_disponible`; resto de `send_failed` → `envio_permanente` + `bot_incident` `envio_permanente`.
- `respuestas.ts` (`/api/brains/messages`): `envio_permanente` → **422**; `canal_no_disponible` → **503 `meta_unavailable`**. `/api/bot/messages` (raíz) conserva 502 para ambos (contrato `openapi.json` intacto).

**Incidentes** (`src/server/bot/incidentes.ts`, migración `0035_bot_incident`)
- Tabla `bot_incident(id, organization_id, conversation_id null, kind, detail, count, first_at, last_at, dedupe_key)`, único `(organization_id, dedupe_key)`, índice por `last_at`.
- `registrarIncidente()` = upsert que suma `count` y mueve `last_at`. Nunca lanza.
- `purgarIncidentesViejos()` (90 días, en lotes) en el barrido de webhooks, junto a `purgarLlamadasViejas`.
- `crearNotaDelSistema(org, conv, texto)` en `src/server/notas.ts` (autor `null`, publica `note.new`).

**Motivos de handoff**: `HANDOFF_REASONS` (+ esquema `conversation.handoff_reason`, solo TS) + etiquetas en `eventos-hilo.ts` y `analytics.ts`.

## 3. Migraciones

| Repo | Archivo | Cambio | Re-ejecutable |
|---|---|---|---|
| crm | `drizzle/0035_bot_incident.sql` | `CREATE TABLE IF NOT EXISTS bot_incident` + FKs (`DROP … IF EXISTS` + `ADD`) + índices `IF NOT EXISTS` | Sí |
| nea | `migrations/010_reanudacion.sql` | `ALTER TABLE … ADD COLUMN IF NOT EXISTS` ×3 | Sí |

## 4. Verificación (PC de gama baja)

- `[crm]` `npx pnpm@11.5.0 typecheck` · `lint` · `vitest run --maxWorkers=1 --no-file-parallelism`.
- `[nea]` `python -m pytest -q` (venv del scratchpad); las doradas B0 en verde sin tocar sus archivos.
- `[CI]` build + E2E. `[staging]` SC-A1…SC-A3 (matar Nea 60 s; llave sin saldo; `pending_send`).
- Nada de `next build`, Docker ni Playwright en local.

## 5. Despliegue

- Orden: **CRM primero** (acepta los motivos nuevos y responde los códigos nuevos; un Nea viejo trata 422/503 como antes), luego Nea.
- Nea: subir el `stop_grace_period` del contenedor (Coolify/compose) a ≥ 40 s para que el cierre ordenado alcance a terminar (`NEA_SHUTDOWN_GRACE_SECONDS=25`).
- Variables nuevas de Nea, todas opcionales: `LLM_TEMPERATURE`, `PENDING_SEND_MAX_MINUTES`, `NEA_SHUTDOWN_GRACE_SECONDS`.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Reanudar un turno que sí tuvo efectos → doble respuesta | Marca pesimista ANTES del efecto; la respuesta del CRM además se deduplica por `(dispatchId, textHash)`. |
| Reanudación en bucle por un bug determinista | `attempts ≤ 3`; después, handoff. |
| Sin `pasarAHumano`, un cerebro caído por horas deja chats sin atender | Cada caída deja nota interna visible en la conversación + `bot_incident`; panel en 074. |
| Gate de saldo bloquea con una lectura de BD por entrante | Lectura simple por organización; solo en plataforma. |
| `temperature` rechazada por un modelo de razonamiento | 400 que la nombra → se apaga 1 h, igual que los extras. |
