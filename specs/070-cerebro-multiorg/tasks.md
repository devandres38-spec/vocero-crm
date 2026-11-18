# Tasks: Cerebro multi-organización (`/api/brains/*`)

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [contracts/brains.md](contracts/brains.md)
**Estado**: diseño — pendiente de aprobación. Sin código.

Convenciones: `[P]` paralelizable · `[local]` gate de este equipo (typecheck,
lint, Vitest 1 worker, pytest) · `[CI/staging]` fuera de este equipo ·
`[nea]` en el repo `nea-agent`.

## Bloque 1 — Base, despliegues, autenticación, núcleo (F0–F3)

### F0 Base
- [ ] T001 Migración `drizzle/0029_cerebros.sql` (plan §Migración) + `schema.ts` (`brainDeployment`, `brainReply`, `brainOperation`, columnas en `organization` y `dispatch`) + journal
- [ ] T002 `src/server/brains/deployment.ts`: `credencialDerivada(secreto, orgId)` (base64url sin relleno) y prueba con el vector gemelo `_BqRKryMUdexcuLj_3RG1ARbgqr_LhXRSLJYmrw5VJ0`
- [ ] T003 Crear/pegar/rotar secreto (≥ 32 bytes, `encryptSecret`, `secretLast4`), pausar/reactivar, borrar solo sin negocios; caché de descifrado ≤ 60 s con invalidación
- [ ] T004 [P] `ACCIONES_AUDITORIA`: `cerebro_creado`, `cerebro_actualizado`, `cerebro_secreto_rotado`, `cerebro_pausado`, `cerebro_reactivado`, `cerebro_asignado`, `cerebro_probado`; prueba de que `detail` nunca lleva secreto

### F1 Despliegues (US1, US2)
- [ ] T005 `src/server/brains/salud.ts`: `probarSalud` (D13: http(s), sin credenciales, sin redirecciones, 5 s, 4 KB, solo `version`/`mode`/`llm`); guarda `last_health_*`
- [ ] T006 API del panel con sesión de Super-Admin: `GET/POST /api/platform/brains`, `PATCH/DELETE …/[id]`, `POST …/[id]/{probar,rotar}`
- [ ] T007 `/platform/cerebros` (lista con salud y nº de negocios, alta con secreto de una vez + copiar con `copiarAlPortapapeles`, probar, rotar con advertencia, pausar) y entrada en la barra lateral
- [ ] T008 Asignación: `asignarCerebro(orgId, deploymentId|null)` + selector en la ficha (pestaña Agente) y en `pestana-agente` del `FormularioBlueprint`; auditado
- [ ] T009 Pruebas US1/US2: secreto nunca en respuestas/listados/auditoría; rotar invalida; borrar con negocios → 409; pausado no asignable

### F2 Autenticación (US3)
- [ ] T010 `src/server/brains/auth.ts` `requireBrain` (contrato §1): 404 en `single`, 429 por IP, 401 uniforme, slug o id, 403 suspendida, ámbito `{organizationId, deploymentId, slug}`
- [ ] T011 Pruebas: credencial de A con cabecera B; de B con A; derivada con otro despliegue; secreto maestro crudo; despliegue pausado; negocio sin cerebro; reasignado (D1 → D2); slug viejo vs id; cuerpo 401 idéntico en todos
- [ ] T012 Guardia estática: toda ruta en `src/app/api/brains/**` llama `requireBrain` y no usa `resolveInstanceOrg`; prueba de `/api/brains/*` = 404 vacío en `single`

### F3 Núcleo compartido (D5)
- [ ] T013 Extraer a `src/server/bot/nucleo/` la lógica de `context`, `messages`, `ficha`, `stage`, `handoff`, `typing`, `media`, `availability`, `bookings` con `organizationId` explícito; `/api/bot/*` delega
- [ ] T014 `[local]` Suite completa sin cambiar ninguna expectativa de `/api/bot/*` ni el cuerpo gemelo de la 021 (SC-001) — commit del Bloque 1

## Bloque 2 — Superficie y despacho (F4–F5)

### F4 Superficie (US5)
- [ ] T015 `GET /api/brains/context`: solo `conversationId`; cuerpo de bot + `agent` (+ `coordinationFollowupEnabled:false`) + `knowledge` (`qa`/`block`) + `llm` solo con credencial `source:"org"` activa
- [ ] T016 `POST /api/brains/messages`: `dispatchId` validado (org + conversación + < 24 h + no `descartado`), 409 `cerebro_reasignado`, idempotencia `brain_reply`, 201, 422 `fuera_de_ventana`, resto de 409 como `/api/bot`
- [ ] T017 [P] `PUT /ficha`, `POST /stage`, `POST /handoff`, `POST /typing` sobre el núcleo
- [ ] T018 [P] `GET /api/brains/media/[mediaId]`: adjunto buscado dentro de la organización; streaming
- [ ] T019 `POST /api/brains/llm/[...ruta]`: proxy con la llave del negocio; prohibido el respaldo del entorno; 402 `sin_credencial`; pausa la credencial ante 401/402 del proveedor (como hoy)
- [ ] T020 Pruebas por endpoint (camino feliz, errores tipados, formas exactas que lee Nea) y prueba que espía el `fetch` del proxy (token del negocio A, nunca `OPENROUTER_API_TOKEN`)

### F5 Despacho (US4)
- [ ] T021 `destinoDe(orgId)` y `despachoActivoPara(orgId)`; `despacharAlCerebro` añade «tiene destino» en `multi`; en `single` sin cambios
- [ ] T022 Worker: destino por fila al entregar, `dispatch.brain_deployment_id`, `expiresAt` al final del cuerpo solo en `multi`; sin destino → la fila caduca a humano con motivo legible
- [ ] T023 `avisarOlvido` al despliegue de la organización de la conversación borrada
- [ ] T024 Interruptor del agente y tarjeta «Quién responde» en `multi` (D11); `GET /api/agent/brain-status` por organización sin URL ni secreto
- [ ] T025 Laboratorio en `multi`: conversaciones `is_test` al cerebro asignado; sandbox intacto
- [ ] T026 Pruebas: cuerpo `multi` + firma fijados (vector gemelo nuevo), olvido firmado con el secreto correcto, suspendida/sin cerebro/pausado/agente apagado no despachan; `single` idéntico
- [ ] T027 `[local]` gate — commit del Bloque 2

## Bloque 3 — Agenda, Blueprint/MCP, aislamiento, cierre (F6–F9)

### F6 Agenda (US6)
- [ ] T028 Módulo agenda efectivo por organización → 404 **vacío**; conversación inexistente → 404 con sobre (prueba de la sonda `cv_sonda`)
- [ ] T029 `GET /agenda/slots` (oferta registrada, `date`, `agendaId`, `{slots, query}`)
- [ ] T030 `POST|PATCH /agenda/book` (201 `{ok, booking}`, 409 con `slots`, 404 `no_booking`)
- [ ] T031 `src/server/brains/seleccion.ts` + `GET /agenda/bookings` + `POST /agenda/cancel` (`confirmation`, `idempotencyKey` en `brain_operation`, `stale_selection`)
- [ ] T032 `POST /agenda/followup` → 409 `followup_not_allowed`
- [ ] T033 Pruebas de agenda (incluida la no emisión de `capabilities`)

### F7 Blueprint / MCP / REST (US2, D12)
- [ ] T034 Blueprint v1: `brain?: {deployment} | null` en Zod, plan y aplicar (idempotente), exportar sin secretos; catálogo y ejemplos
- [ ] T035 MCP `list_brain_deployments`; `get_organization` con `brain`; `GET /api/platform/brains` (token `alp_`); `docs/openapi-platform.json`
- [ ] T036 `docs/openapi-brains.json` generado desde los Zod de `/api/brains/*`

### F8 Aislamiento y contrato gemelo (US7)
- [ ] T037 Matriz `A ↛ B` (`tests/unit/brains-aislamiento.test.ts`): por cada endpoint, recursos de B con credencial de A → 404 y sin escritura (conversación, `dispatchId`, adjunto, cita, `selectionToken`, `idempotencyKey`), y la llave de IA usada es la de A
- [ ] T038 Vectores gemelos CRM: credencial, cuerpo `multi` + firma, `conversation.deleted` + firma, rutas existentes = `RUTAS` de Nea + `/api/brains/stage`
- [ ] T039 `[nea]` Rama `feat/070-cerebro-multiorg`: `RUTAS["/api/bot/stage"] = "/api/brains/stage"` (D3) + `tests/test_brains_gemelo.py` (mismos vectores; el cuerpo `multi` entra por `/vocero/dispatch` en `multi_org`); `pytest` verde
- [ ] T040 `scripts/e2e-cerebro.mjs` + guion `tests/e2e/us-cerebro.md`: dos negocios en un despliegue Nea `multiorg`, contestar, etapa, agenda, adjunto, borrado, suspensión, reasignación, camino infeliz

### F9 Cierre
- [ ] T041 [P] `AGENTS.md`, `CLAUDE.md`, `docs/plataforma-cerebro.md` (alta de Nea `multiorg` en Coolify: `VOCERO_MODE=cloud`, `CRM_ORGANIZATION` vacía, `CRM_BRAIN_SECRET`, `CRM_BASE_URL`), `specs/README.md`
- [ ] T042 Versión 2.10.0 + CHANGELOG («Actualizar desde 2.9»: nada cambia en `single`)
- [ ] T043 `[local]` Gate completo (typecheck, lint, Vitest 1 worker, pytest en Nea)
- [ ] T044 `[CI/staging]` Build + `e2e-cerebro` con Nea `multiorg` real (dos negocios con llaves BYOK distintas)
- [ ] T045 Marcar 070 hecha en `ROADMAP-ALIANTIS.md` y `specs/README.md` solo tras T044; merge de ambos repos cuando el dueño lo pida
