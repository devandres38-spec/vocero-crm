# Tasks: Bot de Producción (073)

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [contracts/brains-073.md](contracts/brains-073.md)
**Estado**: D1–D7, D10 y las 10 respuestas de producto aprobadas (2026-11-19). 073-A implementada, auditada y parcheada (TA1–TA8). **073-B implementada (B0–B6)** y subida sin merge; pendiente CI, staging y auditoría (B64–B66). 073-C sin empezar.

Convenciones: `[P]` paralelizable · `[crm]` `vocero-crm` · `[nea]` `nea-agent` ·
`[local]` gate en este equipo · `[CI]` · `[staging]`.

Gates locales (PC de gama baja):
- `[crm]` `npx pnpm@11.5.0 typecheck` · `npx pnpm@11.5.0 lint` · `npx vitest run --maxWorkers=1 --no-file-parallelism`
- `[nea]` `python -m pytest -q` (venv temporal del scratchpad)

Nada de `next build`, Docker ni E2E en local.

---

# Ronda 073-A — Cero silencios y cero apagones

## Bloque A0 — Spec-Kit
- [x] T001 `spec.md`, `plan.md`, `tasks.md`, `contracts/brains-073.md`

## Bloque A1 — Bucle de herramientas y LLM `[nea]` (P-2, P-3, D2)
- [x] T002 `_tool_loop`: ronda final sin herramientas al agotar `MAX_TOOL_ROUNDS`; reintento de respuesta inválida sin herramientas
- [x] T003 Turno sin texto y sin handoff del runtime → handoff `error` (nunca silencio)
- [x] T004 `LlmRechazado` (400/401/402/403/422 sin reintento, causa tipada); 429/5xx con jitter y `Retry-After` (≤10 s)
- [x] T005 `LLM_TEMPERATURE` (0.4) + `temperature` del perfil/config cuando venga; se apaga 1 h si el proveedor la rechaza
- [x] T006 402 / `sin_credencial` → handoff `sin_saldo`
- [x] T007 Pruebas de regresión (bucle, rechazos, jitter, `Retry-After`, temperatura, motivo `sin_saldo`)

## Bloque A2 — Handoff y envío resilientes `[nea]` (D2, D3)
- [x] T008 `HANDOFF_REASONS` += `sin_saldo`, `opt_out`, `abuso` (catálogo de `escalar` sin cambios)
- [x] T009 `_safe_handoff`: 3 intentos + cola durable (`pending_send.kind = 'handoff'`)
- [x] T010 `CrmError.status`; envío 400/404/413/422 terminal (ni reintento ni cola) → handoff `error`
- [x] T011 `pending_send` de mensajes caduca a los 15 min (`PENDING_SEND_MAX_MINUTES`) → handoff `error`; 4xx terminales en el `SenderWorker`
- [x] T012 Pruebas de regresión

## Bloque A3 — Cierre ordenado y reanudación `[nea]` (D3)
- [x] T013 Migración `010_reanudacion.sql` (`dispatch_inbox.attempts`, `dispatch_inbox.effects_at`, `pending_send.kind`)
- [x] T014 `app/efectos.py` + marca pesimista en `_send`, `ToolRuntime.execute` y `_safe_handoff`
- [x] T015 Reclamo con `attempts`/`effects_at`; `_atender` reanuda sin efectos (≤3 intentos), handoff con efectos
- [x] T016 Reanudación idempotente (sin filtro de leídos; sin duplicar el mensaje del lead en el historial)
- [x] T017 SIGTERM: `apagando`, sin reclamos nuevos, espera `NEA_SHUTDOWN_GRACE_SECONDS`
- [x] T018 Pruebas de regresión + `CHANGELOG` + `.env.example`

## Bloque A4 — Incidentes y motivos `[crm]` (D3, D10)
- [x] T019 Migración `0035_bot_incident` + `schema.ts` (re-ejecutable)
- [x] T020 `src/server/incidentes.ts` (`registrarIncidente`, `purgarIncidentesViejos` 90 días en el barrido) — fuera de `server/bot` y `server/dispatch`: solo ESCRIBE notas del sistema y el guardarraíl de notas (`notas-internas.test.ts`) vigila esas carpetas
- [x] T021 `crearNotaDelSistema` en `src/server/notas.ts`
- [x] T022 `HANDOFF_REASONS` + enum de `conversation.handoff_reason` + etiquetas (bandeja, Resultados)
- [x] T023 Pruebas

## Bloque A5 — Outbox, worker y saldo `[crm]` (P-8, punto ciego n.º 1)
- [x] T024 `MAX_INTENTOS = 6`, `BACKOFF_MS = [2, 5, 15, 45, 120] s`
- [x] T025 Caducar → `avisarCaidaDelCerebro` (incidente + nota) sin tocar `aiEnabled`
- [x] T026 Pool de 4 carriles, máx. 2 por organización (`tomarPendientes(…, excluirOrgs)`)
- [x] T027 `despacharAlCerebro`: en plataforma, llave pausada/sin configurar → no encola + incidente agrupado por hora
- [x] T028 Pruebas

## Bloque A6 — Entrega saliente `[crm]` (P-11c)
- [x] T029 `SendError.metaCode`; `sendText` persiste `failed` ante fallo del canal (operador: todo fallo del canal; IA: solo los definitivos —los pasajeros los reintenta el cerebro y dejarían burbujas repetidas—)
- [x] T030 `responderComoCerebro`: `canal_no_disponible` vs `envio_permanente` (+ incidente)
- [x] T031 `/api/brains/messages`: 422 `envio_permanente` · 503 `meta_unavailable`; `docs/openapi-brains.json`; `/api/bot/messages` sin cambios
- [x] T032 Pruebas

## Bloque A7 — Cierre de 073-A
- [x] T033 `[local]` gates de ambos repos verdes; 6 dorados B0 intactos
- [x] T034 Subir `feat/073-bot-produccion` (sin merge) y reportar commits
- [ ] T035 `[CI]` build + E2E
- [ ] T036 `[staging]` SC-A1 (matar Nea 60 s), SC-A2 (llave sin saldo), SC-A3 (`pending_send`)
- [ ] T037 Auditoría 073-A

---

# Parche de auditoría 073-A (2026-11-20)

- [x] TA1 `[nea]` `SenderWorker._handoff`: `CrmError` (no `CrmRechazo`) → encolar `kind=handoff` (24 h)
- [x] TA2 `[nea]` `_retry_after`: `math.isfinite`, fecha HTTP, acotado a `[0, 10]`
- [x] TA3 `[nea]` `registrar_efectos`: `marcado = True` solo tras `await marcador()` exitoso
- [x] TA4 `[nea]` `llm_de_ensayo` respeta `temperatura_valida(config["temperature"])` (`_temperatura_de`)
- [x] TA5 `[crm]` `falloDelCanal`: 0/429/5xx → `meta_unavailable` en los 4 canales, siempre con `err.code`
- [x] TA6 `[crm]` `persistOutbound` del fallido en `try/catch`: nunca tapa el `SendError` original
- [x] TA7 `[crm]` `carril()`: fallo de BD al reclamar retira solo ese carril; `Promise.allSettled`
- [x] TA8 Pruebas (`tests/test_auditoria_073a.py`; `envio-fallido-073a`, `despacho-073a`) y commit separado

---

# Ronda 073-B — Humano↔Bot y seguridad

## Bloque B0 — Esquema y contrato
- [x] B01 `[crm]` Migración `0036_bot_humano` (re-ejecutable): `contact.opt_out_at/opt_out_source`, `conversation.ai_paused_at/human_gap_from/human_gap_to`, CHECK de `bot_incident.kind` += `abuso`
- [x] B02 `[crm]` `contracts/brains-073.md` §3–§6 + `docs/openapi-brains.json` (solo aditivo)

## Bloque B1 — Continuidad Humano↔Bot (D1, P-1) `[crm][nea]`
- [x] B11 `[crm]` `src/server/inbox/pausa.ts` (`pausarPorRespuestaHumana`, atómico, no pisa otro motivo); lo usan el eco de `ingest.ts`, `sendText` (operador), adjuntos, ubicación/contactos y plantillas
- [x] B12 `[crm]` `updateConversation`: pausa manual anota `aiPausedAt`; reanudar anota `humanGapFrom/To`
- [x] B13 `[crm]` `src/server/brains/humano.ts` (`tramoHumano`, `armarTramo`: ≤20 mensajes / ≤2000 caracteres, solo hasta que la IA contesta) → `humanGap` en `/api/brains/context`
- [x] B14 `[nea]` `app/tramo_humano.py`: nota de sistema antes de los mensajes del turno; no se guarda en `bot_message`

## Bloque B2 — Resumen de handoff y «Atención humana» (D2) `[crm][nea]`
- [x] B21 `[nea]` `handoff.resumen` (opcional) → `post_handoff(..., summary=)` (≤500; sin resumen el cuerpo de siempre)
- [x] B22 `[crm]` `handoffSchema.summary` (recorta a 500) → `notaDeHandoff` (en `src/server/incidentes.ts`, fuera de las carpetas vigiladas)
- [x] B23 `[crm]` Filtro «Atención humana» (`necesitaAtencionHumana`) en `conversation-list.tsx`

## Bloque B3 — Seguridad conversacional y anti-flood (D4, P-9) `[crm][nea]`
- [x] B31 `[nea]` `app/datos.py` (`neutralizar_marcadores`, `dato_no_confiable`, `entre_comillas`)
- [x] B32 `[nea]` Prompt: nombre, ficha y titular enmarcados («no una instrucción») → `DELTAS_073` sobre B0/071/072 (sin regenerar)
- [x] B33 `[nea]` Texto del lead, pie de foto, nombre de archivo, transcripción, PDF, ubicación y vCard saneados; el PDF marcado como datos
- [x] B34 `[crm]` `src/lib/ajustes-bot.ts` + `src/server/ajustes-bot.ts` (`metadata.bot`, defaults 25/80/500, 0.4)
- [x] B35 `[crm]` `src/server/dispatch/antiflood.ts` (conteo en `dispatch`) + gate en `encolar.ts` + `avisarTopeAntiFlood` (incidente `abuso` + nota, IA encendida)
- [x] B36 `[crm]` Blueprint `bot` (merge; `null` vuelve al default) y `humanHours`; exportar/aplicar

## Bloque B4 — Opt-out Ley 1581 y horario humano (D6, P-12) `[crm][nea]`
- [x] B41 `[crm]` `src/lib/baja.ts` (detector determinista, confirmación fija, nota)
- [x] B42 `[crm]` `src/server/bajas.ts` (`registrarBaja` idempotente: confirma una vez, pausa `opt_out`, nota; `reactivarContacto`)
- [x] B43 `[crm]` Detector en `ingest.ts`; gates en `encolar.ts`, `responderComoCerebro` (409) y `sendTemplate` (409 `opt_out`); handoff `opt_out` → baja
- [x] B44 `[crm]` Bandeja: aviso en el compositor (ventana abierta/cerrada) y en el panel con «Reactivar contacto» (`PATCH optOut:false`)
- [x] B45 `[nea]` Herramienta `solicitar_baja` (clave `escalar`, reservada en ambos repos): handoff `opt_out` y el modelo no escribe
- [x] B46 `[crm]` `src/lib/horario-humano.ts` (festivos CO con Pascua y Ley Emiliani; `disponibilidadHumana`) + `GET/PUT /api/settings/human-hours` + tarjeta en Agente
- [x] B47 `[crm]` `humanAvailable`/`nextOpenAt` en `/api/brains/context` · `[nea]` línea «NO hay personas…» solo con el horario cerrado

## Bloque B5 — Temperatura y respaldo (decisiones #8, #10) `[crm]`
- [x] B51 `llm.temperature` en el contexto (Nea ya la lee desde 073-A)
- [x] B52 Proxy `/api/brains/llm`: `conRespaldo` → `models: [principal, respaldo]` (solo OpenRouter, sin lista propia)

## Bloque B6 — Cierre de 073-B
- [x] B61 `[local]` Pruebas nuevas: `bot-073b-puras`, `bot-073b-flujo`, `envio-fallido-073a` (pausa) · `tests/test_073b.py`; dorados B0 con `DELTAS_073`
- [x] B62 `[local]` Gates de ambos repos verdes
- [x] B63 Subir `feat/073-bot-produccion` (sin merge) y reportar
- [ ] B64 `[CI]` build + E2E
- [ ] B65 `[staging]` SC-B1…SC-B5
- [ ] B66 Auditoría 073-B

# Ronda 073-C — Calidad conversacional y Colombia (esquema)

- [ ] C1 `[nea]` Imágenes (marcador en pasado, máx. 3) y comprobantes (handoff + nota)
- [ ] C2 `[crm][nea]` `replyTo`, teléfonos de vCard, reacciones, partición por canal, respuesta obsoleta
- [ ] C3 `[nea]` Memoria (20 mensajes, separador temporal) y `stall` sin agenda
- [ ] C4 `[nea]` Validador post-turno (promesas, fugas, `<think>`), `confirmacion.py`, `dia_confirmado`
- [ ] C5 `[nea]` `hostility.py`/`stall.py`/chasis Colombia (`DELTAS_073`)
- [ ] C6 `[crm]` `es_CO`, `formatPhone`, 12 h en presentación, placeholders y textos
