# Tasks: Cerebro multi-organización (`/api/brains/*`)

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [contracts/brains.md](contracts/brains.md)
**Estado**: diseño aprobado (2026-11-17). Implementada (T001–T043, T040 parcial) en `feat/070-cerebro-multiorg` de vocero-crm y nea-agent; verde local. Pendiente T044 (CI/staging con Nea `multiorg` real) y T045 (cierre).

Convenciones: `[P]` paralelizable · `[local]` gate de este equipo (typecheck,
lint, Vitest 1 worker, pytest) · `[CI/staging]` fuera de este equipo ·
`[nea]` en el repo `nea-agent`.

## Bloque 1 — Base, despliegues, autenticación, núcleo (F0–F3)

### F0 Base
- [x] T001 Migración `drizzle/0029_cerebros.sql` (plan §Migración) + `schema.ts` (`brainDeployment`, `brainReply`, `brainOperation`, columnas en `organization` y `dispatch`) + journal
- [x] T002 `src/server/brains/deployment.ts`: `credencialDerivada(secreto, orgId)` (base64url sin relleno) y prueba con el vector gemelo `_BqRKryMUdexcuLj_3RG1ARbgqr_LhXRSLJYmrw5VJ0`
- [x] T003 Crear/pegar/rotar secreto (≥ 32 bytes, `encryptSecret`, `secretLast4`), pausar/reactivar, borrar solo sin negocios; caché de descifrado ≤ 60 s con invalidación
- [x] T004 [P] `ACCIONES_AUDITORIA`: `cerebro_creado`, `cerebro_actualizado`, `cerebro_secreto_rotado`, `cerebro_pausado`, `cerebro_reactivado`, `cerebro_asignado`, `cerebro_probado`; prueba de que `detail` nunca lleva secreto

### F1 Despliegues (US1, US2)
- [x] T005 `src/server/brains/salud.ts`: `probarSalud` (D13: http(s), sin credenciales, sin redirecciones, 5 s, 4 KB, solo `version`/`mode`/`llm`); guarda `last_health_*`
- [x] T006 API del panel con sesión de Super-Admin: `GET/POST /api/platform/brains`, `PATCH/DELETE …/[id]`, `POST …/[id]/{probar,rotar}`
- [x] T007 `/platform/cerebros` (lista con salud y nº de negocios, alta con secreto de una vez + copiar con `copiarAlPortapapeles`, probar, rotar con advertencia, pausar) y entrada en la barra lateral
- [x] T008 Asignación: `asignarCerebro(orgId, deploymentId|null)` + `PUT /api/platform/organizations/{idOrSlug}/brain` + selector en la ficha (sección «Cerebro» del resumen); auditado. El selector del `FormularioBlueprint` va con el campo `brain` del Blueprint (T034), porque el formulario envía un Blueprint
- [x] T009 Pruebas US1/US2: secreto nunca en respuestas/listados/auditoría; rotar invalida; borrar con negocios → 409; pausado no asignable

### F2 Autenticación (US3)
- [x] T010 `src/server/brains/auth.ts` `requireBrain` (contrato §1): 404 en `single`, 429 por IP, 401 uniforme, slug o id, 403 suspendida, ámbito `{organizationId, deploymentId, slug}`
- [x] T011 Pruebas: credencial de A con cabecera B; de B con A; derivada con otro despliegue; secreto maestro crudo; despliegue pausado; negocio sin cerebro; reasignado (D1 → D2); slug viejo vs id; cuerpo 401 idéntico en todos
- [x] T012 Guardia estática: toda ruta en `src/app/api/brains/**` llama `requireBrain` y no usa `resolveInstanceOrg`; prueba de `/api/brains/*` = 404 vacío en `single`

### F3 Núcleo compartido (D5)
- [x] T013 Extraer a `src/server/bot/nucleo/` la lógica de `context`, `messages`, `ficha`, `stage`, `handoff`, `typing`, `media`, `availability`, `bookings` con `organizationId` explícito; `/api/bot/*` delega
- [ ] T014 `[local]` Suite completa sin cambiar ninguna expectativa de `/api/bot/*` ni el cuerpo gemelo de la 021 (SC-001) — commit del Bloque 1

## Bloque 2 — Superficie y despacho (F4–F5)

### F4 Superficie (US5)
- [x] T015 `GET /api/brains/context`: solo `conversationId`; cuerpo de bot + `agent` (+ `coordinationFollowupEnabled:false`) + `knowledge` (`qa`/`block`) + `llm` solo con credencial `source:"org"` activa
- [x] T016 `POST /api/brains/messages`: `dispatchId` validado (org + conversación + < 24 h + no `descartado`), 409 `cerebro_reasignado`, idempotencia `brain_reply`, 201, 422 `fuera_de_ventana`, resto de 409 como `/api/bot`
- [x] T017 [P] `PUT /ficha`, `POST /stage`, `POST /handoff`, `POST /typing` sobre el núcleo
- [x] T018 [P] `GET /api/brains/media/[mediaId]`: adjunto buscado dentro de la organización; streaming
- [x] T019 `POST /api/brains/llm/[...ruta]`: proxy con la llave del negocio; prohibido el respaldo del entorno; 402 `sin_credencial`; pausa la credencial ante 401/402 del proveedor (como hoy)
- [x] T020 Pruebas por endpoint (camino feliz, errores tipados, formas exactas que lee Nea) y prueba que espía el `fetch` del proxy (token del negocio A, nunca `OPENROUTER_API_TOKEN`)

### F5 Despacho (US4)
- [x] T021 `destinoDe(orgId)` y `despachoActivoPara(orgId)`; `despacharAlCerebro` añade «tiene destino» en `multi`; en `single` sin cambios
- [x] T022 Worker: destino por fila al entregar, `dispatch.brain_deployment_id`, `expiresAt` (creación + 10 min) al final del cuerpo solo en `multi`; sin destino → la fila se descarta (igual que en `single`) y el mensaje queda en la bandeja
- [x] T023 `avisarOlvido` al despliegue de la organización de la conversación borrada
- [x] T024 Interruptor del agente y tarjeta «Quién responde» en `multi` (D11); `GET /api/agent/brain-status` por organización sin URL ni secreto
- [x] T025 Laboratorio en `multi`: conversaciones `is_test` al cerebro asignado; sandbox intacto
- [x] T026 Pruebas: cuerpo `multi` + firma fijados (vector gemelo nuevo), olvido firmado con el secreto correcto, suspendida/sin cerebro/pausado/agente apagado no despachan; `single` idéntico
- [x] T027 `[local]` gate — commit del Bloque 2

## Bloque 3 — Agenda, Blueprint/MCP, aislamiento, cierre (F6–F9)

### F6 Agenda (US6)
- [x] T028 Módulo agenda efectivo por organización → 404 **vacío**; conversación inexistente → 404 con sobre (prueba de la sonda `cv_sonda`)
- [x] T029 `GET /agenda/slots` (oferta registrada, `date`, `agendaId`, `{slots, query}`)
- [x] T030 `POST|PATCH /agenda/book` (201 `{ok, booking}`, 409 con `slots`, 404 `no_booking`)
- [x] T031 `src/server/brains/seleccion.ts` + `GET /agenda/bookings` + `POST /agenda/cancel` (`confirmation`, `idempotencyKey` en `brain_operation`, `stale_selection`)
- [x] T032 `POST /agenda/followup` → 409 `followup_not_allowed`
- [x] T033 Pruebas de agenda (incluida la no emisión de `capabilities`)

### F7 Blueprint / MCP / REST (US2, D12)
- [x] T034 Blueprint v1: `brain?: {deployment} | null` en Zod, plan y aplicar (idempotente), exportar sin secretos; catálogo y ejemplos
- [x] T035 MCP `list_brain_deployments`; `get_organization` con `brain`; `GET /api/platform/brains` (token `alp_`); `docs/openapi-platform.json`
- [x] T036 `docs/openapi-brains.json` generado desde los Zod de `/api/brains/*`

### F8 Aislamiento y contrato gemelo (US7)
- [x] T037 Matriz `A ↛ B` (`tests/unit/brains-aislamiento.test.ts`): por cada endpoint, recursos de B con credencial de A → 404 y sin escritura (conversación, `dispatchId`, adjunto, cita, `selectionToken`, `idempotencyKey`), y la llave de IA usada es la de A
- [x] T038 Vectores gemelos CRM: credencial, cuerpo `multi` + firma, `conversation.deleted` + firma, rutas existentes = `RUTAS` de Nea + `/api/brains/stage`
- [x] T039 `[nea]` Rama `feat/070-cerebro-multiorg`: `RUTAS["/api/bot/stage"] = "/api/brains/stage"` (D3) + `tests/test_brains_gemelo.py` (mismos vectores; el cuerpo `multi` entra por `/vocero/dispatch` en `multi_org`); `pytest` verde
- [~] T040 `scripts/e2e-cerebro.mjs` + guion `tests/e2e/us-cerebro.md` — **guion escrito** (camino feliz e infeliz para staging); el arnés automático `.mjs` queda pendiente: necesita una Nea `multiorg` real y no se puede correr en este equipo: dos negocios en un despliegue Nea `multiorg`, contestar, etapa, agenda, adjunto, borrado, suspensión, reasignación, camino infeliz

### F9 Cierre
- [x] T041 [P] `AGENTS.md`, `CLAUDE.md`, `docs/plataforma-cerebro.md` (alta de Nea `multiorg` en Coolify: `VOCERO_MODE=cloud`, `CRM_ORGANIZATION` vacía, `CRM_BRAIN_SECRET`, `CRM_BASE_URL`), `specs/README.md`
- [x] T042 Versión 2.10.0 + CHANGELOG («Actualizar desde 2.9»: nada cambia en `single`)
- [x] T043 `[local]` Gate completo (typecheck, lint, Vitest 1 worker, pytest en Nea)
- [ ] T044 `[CI/staging]` Build + `e2e-cerebro` con Nea `multiorg` real (dos negocios con llaves BYOK distintas)
- [ ] T045 Marcar 070 hecha en `ROADMAP-ALIANTIS.md` y `specs/README.md` solo tras T044; merge de ambos repos cuando el dueño lo pida

## Notas del Bloque 3

- **Agenda (F6)**: `requireBrainAgenda` = `requireBrain` + módulo agenda del
  negocio (apagado → 404 vacío). `bookings`/`cancel` con selección firmada
  (`aliantis-seleccion:v1`, atada a organización, conversación y revisión),
  `confirmation` e `idempotencyKey` (`brain_operation`); sin anunciar
  `agenda_v2` (D7). `followup` → 409 (D8).
- **Juez del Laboratorio solo BYOK en `multi`** (pedido en la aprobación del
  Bloque 2): `chatJson({ soloOrganizacion })` y la pantalla del Laboratorio
  usan `resolveAiProviderDeOrganizacion`.
- **Notas de voz**: sin migración ni UI. Con una llave de OpenRouter,
  `context.llm.transcribeModel` = `google/gemini-3.5-flash-lite` (el
  `MODELO_QUE_OYE` de Nea, que oye ogg/opus por chat), pagado por el negocio.
  Con OpenAI directo no se envía: su chat solo acepta wav/mp3 y las notas de
  WhatsApp son ogg/opus. **Después de la 070**: elegir el modelo que oye por
  negocio (Ajustes → IA), que sí requiere UI.
- **Blueprint `brain`**: `{deployment}` o `null`; auditado como
  `cerebro_asignado` con `desde: "blueprint"`. Selector en la pestaña Agente.
- **MCP**: `list_brain_deployments` (solo lectura; sin secretos ni URLs
  completas) y `get_organization` con `brain`. Única expectativa existente
  ajustada: la lista de herramientas en `plataforma-mcp.test.ts` (aditiva).
- **Aislamiento (F8)**: matriz con la puerta real y una base que registra los
  parámetros de cada WHERE: con la credencial de A, toda consulta a tablas del
  negocio lleva `org_A` y nunca `org_B`; ninguna escritura ni efecto. Una
  prueba de cobertura obliga a agregar cada ruta nueva a la matriz.
- **Nea**: rama `feat/070-cerebro-multiorg` con `RUTAS["/api/bot/stage"]` y
  `tests/test_brains_gemelo.py` (mismos vectores que
  `cerebros-070-gemelo.test.ts`).

## Auditoría 070 (`../../../AUDITORIA-070.md`)

Remediada en `feat/070-cerebro-multiorg` de ambos repos (antes del merge):

- [x] T046 C-1 — Nea: `CrmRechazo` (401/403 terminales en `multiorg`, fuera de
  la cola sin handoff) · CRM: fallos de cerebro por (IP, organización)
- [x] T047 A-1..A-12 (IP real y tope de llaves, SSRF, URL con ruta + Editar,
  candado de respuestas, BYOK en la UI, `withBrain`, tope de `llm`, Blueprint
  con cerebro pausado, tarjeta «Pausado», caché de salud por URL, lease al
  anotar el despliegue)
- [x] T048 M-1..M-11 + migración `0030_cerebros_indices` (3 índices + `CHECK`)
- [x] T049 B-1..B-7
- [x] T050 Pruebas de regresión: `tests/unit/auditoria-070-puerta.test.ts`,
  `auditoria-070-rutas.test.ts`, casos nuevos del worker; Nea
  `tests/test_brains_rechazo.py`
