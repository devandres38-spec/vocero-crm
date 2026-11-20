# Tasks: Bot de Producción (073)

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [contracts/brains-073.md](contracts/brains-073.md)
**Estado**: D1–D7, D10 y las 10 respuestas de producto aprobadas (2026-11-19). **Ronda 073-A en curso.** 073-B y 073-C sin empezar.

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
- [ ] T002 `_tool_loop`: ronda final sin herramientas al agotar `MAX_TOOL_ROUNDS`; reintento de respuesta inválida sin herramientas
- [ ] T003 Turno sin texto y sin handoff del runtime → handoff `error` (nunca silencio)
- [ ] T004 `LlmRechazado` (400/401/402/403/422 sin reintento, causa tipada); 429/5xx con jitter y `Retry-After` (≤10 s)
- [ ] T005 `LLM_TEMPERATURE` (0.4) + `temperature` del perfil/config cuando venga; se apaga 1 h si el proveedor la rechaza
- [ ] T006 402 / `sin_credencial` → handoff `sin_saldo`
- [ ] T007 Pruebas de regresión (bucle, rechazos, jitter, `Retry-After`, temperatura, motivo `sin_saldo`)

## Bloque A2 — Handoff y envío resilientes `[nea]` (D2, D3)
- [ ] T008 `HANDOFF_REASONS` += `sin_saldo`, `opt_out`, `abuso` (catálogo de `escalar` sin cambios)
- [ ] T009 `_safe_handoff`: 3 intentos + cola durable (`pending_send.kind = 'handoff'`)
- [ ] T010 `CrmError.status`; envío 400/404/413/422 terminal (ni reintento ni cola) → handoff `error`
- [ ] T011 `pending_send` de mensajes caduca a los 15 min (`PENDING_SEND_MAX_MINUTES`) → handoff `error`; 4xx terminales en el `SenderWorker`
- [ ] T012 Pruebas de regresión

## Bloque A3 — Cierre ordenado y reanudación `[nea]` (D3)
- [ ] T013 Migración `010_reanudacion.sql` (`dispatch_inbox.attempts`, `dispatch_inbox.effects_at`, `pending_send.kind`)
- [ ] T014 `app/efectos.py` + marca pesimista en `_send`, `ToolRuntime.execute` y `_safe_handoff`
- [ ] T015 Reclamo con `attempts`/`effects_at`; `_atender` reanuda sin efectos (≤3 intentos), handoff con efectos
- [ ] T016 Reanudación idempotente (sin filtro de leídos; sin duplicar el mensaje del lead en el historial)
- [ ] T017 SIGTERM: `apagando`, sin reclamos nuevos, espera `NEA_SHUTDOWN_GRACE_SECONDS`
- [ ] T018 Pruebas de regresión + `CHANGELOG` + `.env.example`

## Bloque A4 — Incidentes y motivos `[crm]` (D3, D10)
- [ ] T019 Migración `0035_bot_incident` + `schema.ts` (re-ejecutable)
- [ ] T020 `src/server/bot/incidentes.ts` (`registrarIncidente`, `purgarIncidentesViejos` 90 días en el barrido)
- [ ] T021 `crearNotaDelSistema` en `src/server/notas.ts`
- [ ] T022 `HANDOFF_REASONS` + enum de `conversation.handoff_reason` + etiquetas (bandeja, Resultados)
- [ ] T023 Pruebas

## Bloque A5 — Outbox, worker y saldo `[crm]` (P-8, punto ciego n.º 1)
- [ ] T024 `MAX_INTENTOS = 6`, `BACKOFF_MS = [2, 5, 15, 45, 120] s`
- [ ] T025 Caducar → `avisarCaidaDelCerebro` (incidente + nota) sin tocar `aiEnabled`
- [ ] T026 Pool de 4 carriles, máx. 2 por organización (`tomarPendientes(…, excluirOrgs)`)
- [ ] T027 `despacharAlCerebro`: en plataforma, llave pausada/sin configurar → no encola + incidente agrupado por hora
- [ ] T028 Pruebas

## Bloque A6 — Entrega saliente `[crm]` (P-11c)
- [ ] T029 `SendError.metaCode`; `sendText` persiste `failed` ante fallo del canal
- [ ] T030 `responderComoCerebro`: `canal_no_disponible` vs `envio_permanente` (+ incidente)
- [ ] T031 `/api/brains/messages`: 422 `envio_permanente` · 503 `meta_unavailable`; `docs/openapi-brains.json`; `/api/bot/messages` sin cambios
- [ ] T032 Pruebas

## Bloque A7 — Cierre de 073-A
- [ ] T033 `[local]` gates de ambos repos verdes; 6 dorados B0 intactos
- [ ] T034 Subir `feat/073-bot-produccion` (sin merge) y reportar commits
- [ ] T035 `[CI]` build + E2E
- [ ] T036 `[staging]` SC-A1 (matar Nea 60 s), SC-A2 (llave sin saldo), SC-A3 (`pending_send`)
- [ ] T037 Auditoría 073-A

---

# Ronda 073-B — Humano↔Bot y seguridad (esquema; se detalla al arrancar)

- [ ] B1 `[crm]` Pausa al responder desde Bandeja (helper `manual_reply` compartido con `ingest.ts`)
- [ ] B2 `[crm]` `humanGap` en el contexto · `[nea]` inyección única sin guardar en `bot_message`
- [ ] B3 `[crm][nea]` `summary` en handoff + nota interna; filtro «Atención humana»
- [ ] B4 `[nea]` Delimitación/saneado de datos no confiables; marcadores no falsificables (`DELTAS_073`)
- [ ] B5 `[crm]` Anti-flood por conversación/organización (Blueprint; 25/h, 80/día, 500/día)
- [ ] B6 `[crm][nea]` Opt-out Ley 1581 (campo, detector, tool, bloqueos, banner)
- [ ] B7 `[crm][nea]` Horario humano + festivos CO
- [ ] B8 `[crm][nea]` `temperature` y modelo fallback desde `/platform`

# Ronda 073-C — Calidad conversacional y Colombia (esquema)

- [ ] C1 `[nea]` Imágenes (marcador en pasado, máx. 3) y comprobantes (handoff + nota)
- [ ] C2 `[crm][nea]` `replyTo`, teléfonos de vCard, reacciones, partición por canal, respuesta obsoleta
- [ ] C3 `[nea]` Memoria (20 mensajes, separador temporal) y `stall` sin agenda
- [ ] C4 `[nea]` Validador post-turno (promesas, fugas, `<think>`), `confirmacion.py`, `dia_confirmado`
- [ ] C5 `[nea]` `hostility.py`/`stall.py`/chasis Colombia (`DELTAS_073`)
- [ ] C6 `[crm]` `es_CO`, `formatPhone`, 12 h en presentación, placeholders y textos
