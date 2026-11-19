# Tasks: Cerebro Aliantis — producción y chasis extensible

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [contracts/brains-071.md](contracts/brains-071.md)
**Estado**: 📝 pendiente de aprobación de D1–D21. Ninguna tarea empezada.

Convenciones: `[P]` paralelizable · `[nea]` repo `nea-agent` · `[crm]` repo
`vocero-crm` · `[local]` gate en este equipo · `[CI]` job de CI (p. ej.
`postgres` de pytest, `next build`) · `[staging]` validación en Coolify.

Gates locales (PC de gama baja, ROADMAP §2.4):
- `[nea]` `python -m pytest -q`
- `[crm]` `npx pnpm@11.5.0 typecheck` · `npx pnpm@11.5.0 lint` ·
  `npx pnpm@11.5.0 exec vitest run --maxWorkers=1 --no-file-parallelism`
  (o solo los archivos afectados)

Cada bloque cierra con su gate en verde y un commit. Nada de `next build`,
Docker ni E2E en local.

## Bloque 0 — Red de seguridad antes de tocar nada `[nea]`

- [ ] T001 Pruebas doradas del prompt: `tests/test_chasis_dorado.py` congela `build_system_prompt` byte a byte para (a) `single` sin agenda, (b) `single` con agenda, (c) cloud con `agenda_v2`, (d) Instagram; fixtures en `tests/fixtures/prompt/*.txt` (D14, R2)
- [ ] T002 Prueba de concurrencia intra-negocio (hoy en rojo, marcada `xfail`): dos turnos del mismo negocio con contextos distintos intercalando `await`; documenta H2/H4
- [ ] T003 `[local]` pytest: 567 + doradas en verde — commit «071 B0: red de seguridad»

## Bloque A1 — Concurrencia y estado por turno `[nea]` (D1–D4) · US1, US2

- [ ] T004 Migración `migrations/009_retencion.sql` (índices de D7 incl. `dispatch_inbox(organization_id, conversation_id, created_at) WHERE state<>'done'`); idempotente
- [ ] T005 `PgStore.migrate()` bajo `pg_advisory_lock(hashtextextended('nea:migrate',0))` (H9)
- [ ] T006 `PgDispatchStore.claim_dispatch(owner, orgs_al_tope)`: CTE de plan §A1, sin advisory lock ni conexión retenida; `heartbeat`/`finish` por el pool con *fencing*; `MemoryDispatchStore` con la misma semántica (FIFO por conversación, `started` vivo bloquea)
- [ ] T007 `dispatch_worker.run`: `DISPATCH_CONCURRENCY` tareas consumidoras, contador por org (`DISPATCH_MAX_POR_ORG`), arranque/apagado limpio; `Settings`: `dispatch_concurrency=8`, `dispatch_max_por_org=3`, `db_pool_max` (default `concurrency+4`, mín. 4); `PgStore.connect` con `min_size=2, max_size=db_pool_max`
- [ ] T008 Ajustar pruebas que dependían del lock por org (`test_dispatch_durable.py`): misma conversación en serie, conversaciones distintas en paralelo, olvido después del turno previo
- [ ] T009 `[CI]` `tests/test_pg_store.py`: dos conexiones reclaman a la vez → nunca dos `started` de la misma conversación; orden FIFO; lease vencido → `recovery=True`; tope por org
- [ ] T010 `RegistroDeOrganizaciones`: un `httpx.AsyncClient` compartido (`Limits(32,16)`), `cliente_del_turno(org_id, slug)` efímero (`propietario=False`), cabecera `X-Vocero-Organization` = id (D4); `llm()` con `AsyncOpenAI(http_client=compartido)` en LRU de 256 sin cierre; `aclose()` cierra solo el transporte
- [ ] T011 `BrainsCrmClient(propietario=…)`: `aclose()` no cierra un transporte ajeno; cabeceras por petición; se eliminan los diccionarios por conversación que sobran (el cliente vive un turno)
- [ ] T012 `PerfilDelTurno` (perfil fijo del contexto) y `_contexto_multiorg` con `replace(...)` completo (plan §A2); cloud de un negocio por el mismo camino
- [ ] T013 `single`: `ctx_turno = replace(ctx)` siempre (H4); `conversation_lock` con clave `(org_id, identity)`
- [ ] T014 `ctx_de_organizacion` (sender, seguimiento) con `cliente_del_turno`; ensayo deja de cerrar transporte compartido
- [ ] T015 Pruebas: T002 pasa a verde; A↛B: 404 de agenda o perfil de A no alcanza a B; cambio de slug no rompe (cabecera = id); ningún dict crece tras 1 000 turnos simulados
- [ ] T016 `[local]` pytest verde — commit «071 A1: turnos concurrentes y estado por turno»

## Bloque A2 — Envío diferido y mantenimiento `[nea]` (D6, D7) · US3, US4

- [ ] T017 `PgStore.claim_pending_sends(limit)` por lease (D6); `MemoryStore` equivalente; `SenderWorker` lo usa
- [ ] T018 `SenderWorker._attempt`: `except CrmRechazo` antes de `CrmError` → `mark_pending_send_abandoned`, sin handoff, log `warning` con org
- [ ] T019 `[P]` `app/mantenimiento.py` `MantenimientoWorker` (cada 3 600 s, `pg_try_advisory_xact_lock`, lotes de 1 000 por `ctid`); `Settings`: `retention_days=14 (ge=2)`, `pending_retention_days=30`; arranca en `lifespan`
- [ ] T020 Pruebas: sender no duplica con dos reclamos; 401 terminal; purga respeta retención y no toca `queued`/`started`; `relay_queue` sigue existiendo
- [ ] T021 `[CI]` purga y reclamo de `pending_send` contra Postgres
- [ ] T022 `[local]` pytest verde — commit «071 A2: sender seguro y retención»

## Bloque A3 — Agenda por negocio y multimedia `[nea]` (D5, D12) · US2, US5

- [ ] T023 `BusinessProfile.agenda_enabled` desde `agent.agendaEnabled`; `agenda_vigente(ctx)`: perfil del turno → sonda del turno → `ctx.agenda_enabled`
- [ ] T024 `RegistroDeOrganizaciones.sonda(org_id)` (una `SondaDeAgenda` por org con su `cliente_del_turno`); se quita la sonda global en `multiorg`; `CrmSinOrganizacion.sondear_agenda` queda para el arranque
- [ ] T025 Ajustar `test_agenda_404.py` / `test_agenda_sonda.py` (R4): la expectativa pasa del `ctx` global a la sonda/el turno
- [ ] T026 `turn.py`: imágenes al último `role:"user"` (FR-010); pruebas con `HOSTILITY_ALERT` y `STALL_ALERT` en el mismo turno
- [ ] T027 `llm.py`: `ImagenNoSoportada` (patrones de D12), `_vision_ok` pegajoso; `turn.py` quita imágenes, marcador honesto y un reintento; sin handoff `error`
- [ ] T028 `[local]` pytest verde — commit «071 A3: agenda por negocio y visión honesta»

## Bloque A4 — Observabilidad y superficie `[nea]` (D8–D11) · US3

- [ ] T029 `app/observabilidad.py`: `contextvars` (`org`, `dispatch`, `conversation`), `FormatoJson` stdlib, filtro `EnmascararDigitos`; `LOG_FORMAT` (default json en cloud); se fija en worker, sender, ensayo
- [ ] T030 Ampliar `test_logs_sin_token.py` a JSON y al enmascarado (ningún secreto ni teléfono completo en ninguna línea)
- [ ] T031 `/health`: `queues` con timeout 1 s, `null` si falla; prueba de tamaño < 1 KB y de que el status lo decide solo `ping()` (H11)
- [ ] T032 FastAPI sin docs salvo `NEA_DOCS=1` (D10); prueba 404 de `/docs`, `/redoc`, `/openapi.json`
- [ ] T033 Ensayo: semáforo `ENSAYO_CONCURRENCY` (429 `ocupado`), `ENSAYO_TIMEOUT_SECONDS` (200 `tiempo_agotado` + parciales); pruebas
- [ ] T034 `.env.example` documenta todas las variables nuevas con su default y su razón
- [ ] T035 `[local]` pytest verde — commit «071 A4: observabilidad y superficie»

## Bloque C — vocero-crm `[crm]` (D5, D19) · US7 (puede ir en paralelo a A)

- [ ] T036 `drizzle/0031_agente_trato.sql` (aditiva, re-ejecutable) + `schema.ts` + journal
- [ ] T037 `[P]` `src/lib/agent-roles.ts`: `TRATOS`, `esTrato`, `tratoDe` (desconocido → `tu`)
- [ ] T038 `serializeBotProfile`: `treatment`, `stallEnabled`; `contextoDelCerebro`: `agent.agendaEnabled`; pruebas de forma en `/api/bot/profile` y `/api/brains/context` (cuerpo gemelo actualizado)
- [ ] T039 `GET/PUT /api/agent/profile` con Zod (`treatment` enum, `stallEnabled` boolean); soporte `configuracion` sigue pudiendo editar
- [ ] T040 UI `agent-client.tsx`: selector «Trato» (Tú · Usted · Neutro) y «Cerrar conversaciones sin rumbo» con texto de ayuda; textos de marca Aliantis
- [ ] T041 Blueprint: `agentSchema` (`treatment`, `stallEnabled` opcionales, `.strict()`), `CAMPOS` de `secciones/agente.ts`, `exportar.ts`, `formulario-blueprint.ts`, `pestana-agente.tsx`; prueba de idempotencia (SC-006)
- [ ] T042 `[P]` Catálogo: `agent.treatments` en `catalogoPlataforma()` (MCP `get_catalog`); JSON Schema del contrato regenerado
- [ ] T043 `[P]` OpenAPI: `docs/openapi.json`, `docs/openapi-brains.json`, `docs/openapi-platform.json`; caso explícito de cabecera con id en `/api/brains/*` (R9)
- [ ] T044 `package.json` 2.11.0 + notas de versión
- [ ] T045 `[local]` typecheck, lint, Vitest (1 996 + nuevas) — commit «071 C: trato, cierre sin rumbo y agenda en el contexto»

## Bloque B — Chasis, roles y ajustes universales `[nea]` (D13–D18, D20) · US6, US7, US8

- [ ] T046 `app/chasis/secciones.py` + `armar.py`: el texto actual troceado; `build_system_prompt` lo usa; **doradas de T001 idénticas**
- [ ] T047 `app/roles.py`: `RolSpec`, `ROLES={"calificador"}`, `rol_de()`; `enfoque` sustituye a los `.replace()` de `profile.cloud`; la línea de cancelar depende de `agenda_v2`; doradas idénticas
- [ ] T048 `app/herramientas/registro.py` + `builtin.py`: `ToolSpec(nombre, clave, esquema, ejecutar, disponible)`; `tool_schemas`/`solo_encendidas`/`execute` por registro; `esquema_de_ficha(context)` (D20); todas las pruebas de herramientas sin cambio
- [ ] T049 Trato (D15): `BusinessProfile.treatment`; sección `voz` por trato; regla de idioma; dorada nueva para `usted`, `neutro` y la regla de idioma
- [ ] T050 `stallEnabled` (D16): `sin_rumbo` y puerta 1.5 condicionados; pruebas
- [ ] T051 `app/confirmacion.py` (D17) para book y reschedule, con trato; banco de ≥ 30 casos (ok / pie / contradicción, formatos 12 h y 24 h, «hoy», «mañana», con y sin enlace); `test_tools.py` actualizado (R4)
- [ ] T052 Formato por canal (D18): `a_texto_plano`, `formatear_para(canal)`; vectores gemelos de `plainSocialText` copiados del CRM; `CORRIGE_RESPUESTA` sin «WhatsApp»
- [ ] T053 Marca (D13): `AGENT_NAME="Asistente"` (config, profile, multiorg), título, `webhook_retirado`, marcadores sin género; pruebas que esperaban «Nea» ajustadas (R4)
- [ ] T054 Barrido de marca: prueba que recorre las cadenas de `prompt`, `media`, `tools`, `turn`, `confirmacion`, `webhook_retirado` y respuestas HTTP y falla con «Nea» o «Vocero» visibles (excepto cabeceras/rutas del contrato)
- [ ] T055 `CHANGELOG.md` «Sin publicar», `README`/`AGENTS.md` (variables y modos)
- [ ] T056 `[local]` pytest verde — commit «071 B: chasis por secciones, roles, trato y marca»

## Bloque Z — Cierre `[CI]` `[staging]`

- [ ] T057 `[CI]` nea: jobs `pytest` y `postgres` en verde; crm: `next build` + E2E en verde
- [ ] T058 `[staging]` Despliegue CRM 2.11 + Nea 071 en Coolify; `mem_limit` 1 GiB a Nea
- [ ] T059 `[staging]` Carga: 30 conversaciones simultáneas de un negocio de prueba (Laboratorio o `scripts/e2e_contra_raiz.py` adaptado) — sin duplicados, RSS < 600 MiB, conexiones ≤ `DB_POOL_MAX` (SC-004); medir el pool del CRM (R7)
- [ ] T060 `[staging]` Manual: usted/neutro, otro idioma, `stallEnabled=false`, imagen con modelo sin visión, confirmación de cita con voz del negocio, IG sin marcas, `/health` visto como `multiorg` en `/platform/cerebros`
- [ ] T061 `ROADMAP-ALIANTIS.md`, `specs/README.md` → ✅; merge `--no-ff` a `main` en ambos repos

## Dependencias

```text
B0 ──► A1 ──► A2 ──► A3 ──► A4 ──► B ──► Z
                 C (paralelo desde el inicio; Nea tolera su ausencia)
```

B va después de A porque el chasis por secciones toca `turn.py` (imágenes,
formato, confirmación) y conviene hacerlo sobre el turno ya aislado.
