# Tasks: Multi-Tenant SaaS (modo plataforma)

**Input**: [spec.md](spec.md) · [plan.md](plan.md) (rev. 2)
**Estado**: en ejecución. Bloques 1 y 2 hechos y verificados en local; Bloque 3
(US5, US4, US6, US9 y cierre) pendiente de aprobación.

| Bloque | Tareas | Commits | Verificación local |
|---|---|---|---|
| 1 — Base + US1 + US2 | T001–T028 | `3784baa` spec · `5425461` base + US1 · `04d76dc` US2 | typecheck ✓ · lint ✓ · Vitest 138 archivos / 1606 pruebas ✓ |
| 2 — US3 + US7 + US8 | T029–T047 | `f4a5bcf` US3 · `91dccf8` + `b52bfff` US7 · `72f4a76` US8 | typecheck ✓ · lint ✓ · Vitest 142 archivos / 1646 pruebas ✓ |

Antes de la 069: 130 archivos / 1489 pruebas. Ninguna expectativa existente
cambió (SC-001); solo se añadieron casos.

**Notas del Bloque 1**
- Además de lo previsto: la API propia del plugin `organization` de Better Auth
  (`/organization/create`, `/invite-member`, `/accept-invitation`…) queda cerrada
  en ambos modos salvo `set-active`; abierta permitía crearse un negocio o una
  segunda membresía saltándose la plataforma.
- `branding.ts`/`apariencia.ts` sin sesión en `multi` ya devuelven la marca de
  plataforma (nunca «la primera»); la resolución por subdominio sigue en US4.
- `/api/bot/openapi.json` (documentación estática, sin datos) sigue respondiendo
  en `multi`; el resto de `/api/bot/*` es 404.
- La API REST mínima del panel se adelantó de T043 porque el panel la necesita.

**Notas del Bloque 2**
- US3: aceptar = cuenta nueva por el bypass interno o cuenta existente SOLO con
  su sesión; membresía + uso único en una transacción con la invitación
  bloqueada (`FOR UPDATE`). `POST /api/invitaciones/aceptar` con límite por IP.
  Selector `/empresas` (enlace al subdominio; `set-active` sin dominio base) y
  acceso «Cambiar de empresa» en el menú.
- US7: ~40 superficies pasan de la bandera de instancia a
  `agendaActiva`/`atribucionActiva`/`canalActivo` (sesión, sin consultas) o
  `modulosDeOrganizacion(id)` (en `single`, el techo sin tocar la base). La
  ingesta descarta un canal apagado en la organización. Guardarraíl
  `modulos-por-organizacion` con su lista de excepciones razonadas.
- `enabledChannels()` lee `process.env` directo (como `agendaEnabled()`): el
  techo se consulta en cada petición y no puede depender de que todo el entorno
  valide. Mismo resultado que con `getEnv()`.
- US8: `agenda/settings.ts` acepta la transacción del Blueprint y expone
  `siguienteConfiguracion` (puro); los límites del Blueprint son los de la UI.
  `aplicar(exportar(org))` = `sin_cambios` está probado.
- Tokens: un token presentado e inválido responde 401 (no 404); los tokens se
  gestionan solo con sesión. `GET /blueprint` y el `dryRun` piden alcance `read`.
- Pendiente para el Bloque 3: el `owner` aún no ve accesos de soporte (US5) y la
  marca del login sigue siendo la de plataforma hasta US4.

**Formato**: `[ID] [P?] [Story] Descripción` · `[P]` = paralelizable ·
Verificación `[local]` (typecheck, lint, Vitest `--maxWorkers=1
--no-file-parallelism`) o `[CI/staging]` (build, E2E).

---

## Phase 1: Setup

- [x] T001 Rama `feat/069-multitenant-saas` en `vocero-crm` (primer commit: estos artefactos)
- [x] T002 [P] `.env.example`: `TENANCY`, `PLATFORM_BASE_DOMAIN`, `PLATFORM_ADMIN_EMAILS`, `PLATFORM_MCP` con guía inline (DNS y certificado comodín; MCP apagado por defecto)
- [x] T003 [P] `src/lib/env.ts`: las cuatro variables, opcionales y sin tumbar el arranque

## Phase 2: Foundational (bloquea las historias)

- [x] T004 `src/lib/tenancy.ts`: `tenancy()`, `esPlataforma()`, `dominioBase()`, `mcpActivo()`, `validarSlug()`, `SLUGS_RESERVADOS`
- [x] T005 [P] `tests/unit/tenancy.test.ts`: valores por defecto, valor inválido → `single`, reglas de slug y reservados `[local]`
- [x] T006 `src/lib/db/schema.ts`: columnas de `organization` (`status`, `suspended_at`, `modules`) e `invitation` (`token_hash`, `accepted_at`), tablas `platform_admin`, `support_grant` (con `level`), `platform_api_token`, `platform_audit_log` (con `via`, `token_id`) → `npx pnpm@11.5.0 db:generate` → revisar y renombrar `drizzle/0028_plataforma.sql` (solo `ADD COLUMN` / `CREATE`) `[local]`
- [x] T007 `src/server/modulos/efectivos.ts` (puro): `modulosEfectivos(techo, org)`, `CATALOGO_VERTICAL` (vacío), tipo `ModulosOrganizacion` (Zod)
- [x] T008 [P] `tests/unit/modulos-efectivos.test.ts`: `null` = techo; techo apagado gana; WhatsApp siempre; vertical desconocido rechazado `[local]`
- [x] T009 `src/server/tenant/host.ts`: `slugDelHost(host, dominioBase)` (puro) y `organizacionPorHost(headers)`
- [x] T010 `src/server/tenant/contexto.ts`: `resolverContexto(headers)` (D4) con `grant` y `modulos`; en `single` delega en `resolveMembership` y `modulos` = techo
- [x] T011 `src/lib/auth/session.ts`: `requireSession`/`getSessionOrNull` sobre el resolvedor; `SessionContext` gana `via`, `grant?`, `modulos`
- [x] T012 [P] `tests/unit/tenant-contexto.test.ts` (dependencias inyectadas, sin BD): host→slug, raíz→`activeOrganizationId` validada, no miembro → ninguno, suspendida, `single` = primera membresía `[local]`
- [x] T013 [P] `src/server/platform/auditoria.ts`: `auditar(entrada)` con `via`/`tokenId` + tipos de acción; `doctor`: ✗ `multi` sin dominio base, avisos (`PLATFORM_ADMIN_EMAILS`, `TENANCY` inválida, `PLATFORM_MCP` en `single`) `[local]`

**Checkpoint**: contexto (organización, rol, grant, módulos) resuelto en un solo lugar; `single` sin cambios.

---

## Phase 3: User Story 1 — Modo plataforma con candados (P1) 🎯 MVP

- [x] T014 [US1] `server/auth/registration.ts`: en `multi`, registro solo para `PLATFORM_ADMIN_EMAILS`; `on-signup.ts`: en `multi` no crea organización e inserta en `platform_admin`; extraer `sembrarOrganizacion(tx, orgId)`
- [x] T015 [US1] `server/bot/auth.ts` `requireBotKey`: 404 vacío en `multi` antes de mirar la llave
- [x] T016 [US1] `server/brains/config.ts` `despachoActivo()`: falso en `multi`
- [x] T017 [P] [US1] `lib/storage/medios.ts` `comprobarSegmento`: rechaza `.`, `..`, `/`, `\`
- [x] T018 [P] [US1] Pruebas: registro por modo, bot 404 en `multi` y 401/200 en `single`, despacho por modo, segmentos peligrosos `[local]`
- [x] T019 [US1] Guardarraíl `tests/unit/sin-primera-organizacion.test.ts` `[local]`
- [x] T020 [US1] Suite completa con `TENANCY` vacía sin cambiar expectativas (SC-001) `[local]`

---

## Phase 4: User Story 2 — Panel de agencia (P1)

- [x] T021 [US2] `server/platform/guardia.ts`: `esSuperAdmin(userId)`, `requirePlataforma(req, { scope })` — sesión de Super-Admin (`via: sesion`); 404 si no (el Bearer se suma en T047)
- [x] T022 [US2] `lib/platform/blueprint.ts`: contrato Zod v1 completo (`.strict()`, sin secretos, límites de tamaño) + JSON Schema exportado
- [x] T023 [US2] `server/platform/blueprint/aplicar.ts`: esqueleto (transacción, bloqueo por organización, `dryRun`, respuesta y auditoría) + secciones `organization`, `region`, `brand`, `owner`; crear organización = `sembrarOrganizacion` + aplicar
- [x] T024 [US2] `server/platform/invitaciones.ts`: crear (token 32 bytes, SHA-256, 7 días), revocar; URL devuelta una vez (lo usa la sección `owner`)
- [x] T025 [US2] `server/platform/organizaciones.ts`: listar, detalle, suspender, reactivar; auditado
- [x] T026 [US2] UI `app/(platform)/platform/`: lista, detalle (invitar, suspender/reactivar); asistente `nuevo/` pasos a (info, región, marca) y f (owner)
- [x] T027 [US2] Suspensión: el resolvedor marca `suspendida`; página y 403 `organizacion_suspendida`; `inbox/send.ts` y `dispatch/encolar.ts` lo respetan; la ingesta no
- [x] T028 [P] [US2] Pruebas: slug inválido/reservado/repetido → 422; no-superadmin → 404; suspensión bloquea envío y no ingesta; fallo en una sección → nada creado; A↛B al administrar `[local]`

---

## Phase 5: User Story 3 — Invitación y varias empresas (P1)

- [x] T029 [US3] `invitaciones.ts` `aceptarInvitacion(token, datos)`: transacción, usuario nuevo por `runInternalSignup` o existente con sesión, `member`, `accepted`
- [x] T030 [US3] `app/(auth)/invitacion/[token]/` (página + acción): estados vigente/vencida/usada/otro correo
- [x] T031 [US3] `app/(app)/empresas/`: selector en el dominio raíz (+ `organization/set-active`); `auth/index.ts`: `crossSubDomainCookies` y `trustedOrigins` comodín en `multi`
- [x] T032 [US3] Ajustes → Equipo en `multi`: correo existente → invitación (no membresía directa)
- [x] T033 [P] [US3] Pruebas: token vencido/usado/ajeno, idempotencia, hash (el token en claro nunca se guarda), A↛B: miembro de A en el host de B → ninguno `[local]`

---

## Phase 6: User Story 7 — Módulos por organización (P1)

- [x] T034 [US7] `server/modulos/consulta.ts`: `moduloActivo(ctx, "agenda" | "atribucion")`, `canalActivo(ctx, canal)`, respuestas 404 reutilizando las de cada bandera
- [x] T035 [US7] Migrar consumidores con organización (páginas de `(app)`, `settings/*`, `api/bookings`, `api/calendar/*`, `api/settings/{capi,channels,google,zoom,instagram,messenger,tiktok,webhook}`, `server/{agenda/context,inbox/send,onboarding/status,channels/status,analytics/bot,attribution/*,zernio/*}`) a `moduloActivo`/`canalActivo`
- [x] T036 [US7] Webhooks de canal (`ig`, `messenger`, `tiktok`): tras resolver la organización por token, canal apagado en la organización → 200 + descarte con log `canal_apagado_org`
- [x] T037 [US7] Sección `modules` del Blueprint + pestaña Módulos en `/platform/organizaciones/[id]` (techo deshabilitado «no disponible en esta instancia»)
- [x] T038 [US7] Guardarraíl `tests/unit/modulos-por-organizacion.test.ts` (lista corta de archivos permitidos) `[local]`
- [x] T039 [P] [US7] Pruebas: org sin módulos = techo; org apagada → 404 en agenda y atribución; canal apagado en webhook → descartado sin contacto; WhatsApp no se apaga (422); vertical desconocido 422; A↛B `[local]`

---

## Phase 7: User Story 8 — `OrganizationBlueprint` completo (P1)

- [x] T040 [US8] Secciones `pipeline` (por nombre, reordenar, conservar etapas con leads + advertencia, anclas intactas) y `agent` (perfil sin `enabled`; `role`/`tools` contra catálogo)
- [x] T041 [US8] Sección `knowledge` (`merge` / `exact`, comparación normalizada) y `agenda` (validador de `weeklyHours` de Ajustes → Agenda; advertencia `modulo_apagado`)
- [x] T042 [US8] `blueprint/exportar.ts`: `exportarBlueprint(orgId)` (inverso exacto)
- [x] T043 [US8] REST `app/api/platform/organizations/**`: `GET/POST /organizations`, `GET /{idOrSlug}`, `GET/PUT /{idOrSlug}/blueprint` (`?dryRun=true`), `POST /{idOrSlug}/{suspend,reactivate,invitations}`, `GET /catalog`
- [x] T044 [US8] Asistente `/platform/nuevo`: pasos b–e (módulos, pipeline, agente + conocimiento, agenda), vista previa del `dryRun`, «Ver JSON» / «Importar JSON»; detalle: aplicar JSON
- [x] T045 [US8] Ajustes → Equipo: «Cambios de la plataforma» (entradas `blueprint_aplicado` de SU organización) para el `owner`
- [x] T046 [P] [US8] Pruebas: doble aplicación = `sin_cambios` y cero filas nuevas (SC-004); `aplicar(exportar(org))` = `sin_cambios`; sección ausente intacta; `dryRun` no escribe; campo desconocido / secreto / rol / zona / horario inválido → 422 con `path`; etapa con leads conservada; `owner` pendiente sin URL y `regenerate`; concurrencia serializada; A↛B `[local]`
- [x] T047 [US8] `server/platform/tokens.ts` + `/platform/tokens` (crear, revocar, mostrar una vez, `last4`); `requirePlataforma` acepta `Bearer` (`via: api`), alcances `read`/`provision`, `last_used_at`; pruebas de token revocado/vencido/alcance `[local]`

---

## Phase 8: User Story 5 — Acceso de soporte en dos niveles (P1)

- [ ] T048 [US5] `server/platform/soporte.ts`: solicitar (nivel, motivo ≥ 10, caducidad ≤ 8 h), revocar, `grantVigente(userId, orgId)`
- [ ] T049 [US5] Resolvedor: Super-Admin + grant vigente de la organización del host → `role: "soporte"`, `grant.level`; sin grant → 404 + `acceso_denegado`
- [ ] T050 [US5] `lib/api.ts` `withAuth`: opción `soporte?: "configuracion"`; regla `GET` libre, mutación solo con nivel `configuracion` + ruta que lo declara, si no 403 `solo_lectura` / `fuera_de_alcance`; auditar cada petición y `changedKeys` en mutaciones; `canConfigure("soporte")` según nivel
- [ ] T051 [US5] Declarar `soporte: "configuracion"` en `api/settings/{branding,appearance}`, `api/pipeline/stages/**`, `api/calendar/settings`, `api/agent/profile`, `api/kb/**` (y nada más)
- [ ] T052 [US5] UI: banda «Acceso de soporte (lectura|configuración) — vence HH:MM» en `AppShell`; `/platform/soporte` (solicitar con nivel / revocar) y `/platform/auditoria` (filtros por organización, vía, acción); Ajustes → Equipo muestra al `owner` los accesos con su nivel
- [ ] T053 [P] [US5] Pruebas: sin grant 404 y auditado; grant de A no abre B; `lectura` → escritura 403 `solo_lectura`; `configuracion` → perfil/KB/etapas/agenda/marca 200 con `changedKeys`, envío/contactos/equipo/IA/WhatsApp 403 `fuera_de_alcance`; guardarraíl con la lista exacta de rutas que declaran el alcance; vencido/revocado corta `[local]`

---

## Phase 9: User Story 4 — Marca por subdominio (P2)

- [ ] T054 [US4] `server/branding.ts` y `server/apariencia.ts`: sin organización → por host en `multi`, `DEFAULT_BRANDING` si no hay coincidencia; `single` igual
- [ ] T055 [US4] Consumidores: `app/layout.tsx`, `(auth)/layout.tsx`, `manifest.ts`, `api/branding/favicon/route.ts`, `server/app-icon.tsx`
- [ ] T056 [P] [US4] Pruebas: host de A → marca de A; raíz / slug inexistente / suspendida → Aliantis; `single` → como hoy `[local]`

---

## Phase 10: User Story 6 — Región por organización (P2)

- [ ] T057 [US6] `lib/region.ts` + `server/region.ts`: `getRegionDeOrganizacion(orgId)` (metadata ∪ `REGION_*`)
- [ ] T058 [US6] Consumidores: `RegionProvider` del layout raíz por organización; `api/contacts` e importación (país); `agenda/settings` (zona por defecto); `analytics/period`
- [ ] T059 [US6] Ajustes → Marca: país y locale (API `/api/branding` acepta `region`)
- [ ] T060 [P] [US6] Pruebas: org MX en instancia CO usa MX; sin región hereda `REGION_*`; A↛B al guardar región `[local]`

---

## Phase 11: User Story 9 — Servidor MCP de aprovisionamiento (P2)

- [ ] T061 [US9] **R2**: verificar en el paquete `@modelcontextprotocol/sdk` (versión exacta, ≥ 2 semanas) el transporte Streamable HTTP sobre `Request`/`Response`; si no sirve, respaldo JSON-RPC propio sin dependencia. Registrar la decisión en el plan
- [ ] T062 [US9] `server/platform/mcp/herramientas.ts`: `get_catalog`, `list_organizations`, `get_organization`, `get_blueprint`, `plan_blueprint`, `apply_blueprint`, `create_owner_invitation`, `suspend_organization`, `reactivate_organization` — adaptadores de los servicios; `inputSchema` del JSON Schema de T022; alcance por herramienta
- [ ] T063 [US9] `app/api/platform/mcp/route.ts`: 404 si `!mcpActivo()` o `single`; guardia `Bearer` (`via: mcp`); sin estado
- [ ] T064 [P] [US9] Pruebas: bandera apagada 404; sin token / revocado 401 auditado; `read` no puede `apply_blueprint`; `tools/list` sin herramientas de datos personales ni soporte (lista exacta); **equivalencia REST↔MCP** (mismo Blueprint → mismo estado y auditoría salvo `via`) (SC-005) `[local]`
- [ ] T065 [US9] `docs/plataforma-mcp.md`: crear token, configurar Claude Code/Desktop y Gemini CLI, ejemplo de Blueprint, límites (sin OAuth todavía)

---

## Phase 12: Polish & Release

- [ ] T066 `docs/openapi-platform.json` (REST de D13, generado/validado contra el Zod del Blueprint)
- [ ] T067 `scripts/e2e-plataforma.mjs` + guion `tests/e2e/us-plataforma.md` (dos negocios — uno por asistente, otro por MCP —, módulos distintos, invitación, cambio de empresa, suspensión, marca por subdominio, soporte en ambos niveles; camino infeliz)
- [ ] T068 [P] `AGENTS.md`, `CLAUDE.md` (modo plataforma, resolvedor, módulos efectivos, Blueprint, soporte, MCP), `INSTALL-IA.md` y README (DNS/TLS comodín en Coolify), `specs/README.md`
- [ ] T069 Versión 2.9.0 (`package.json`, `docker-compose.yml`, `render.yaml`, `fly.toml`, `railway.toml`, `INSTALL-IA.md`); `CHANGELOG.md` con «Actualizar desde 2.8» (nada cambia en `single`; cómo pasar a `multi`; banderas como techo)
- [ ] T070 Gate local completo `[local]`
- [ ] T071 Build + E2E (`e2e-plataforma` y los existentes con `TENANCY` vacía y con `multi`) `[CI/staging]`
- [ ] T072 DNS y certificado comodín verificados en Coolify — **verificación humana** `[CI/staging]`
- [ ] T073 Marcar 069 como hecha en `ROADMAP-ALIANTIS.md` y `specs/README.md` solo tras T071–T072

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 (T006 migración, T007 módulos efectivos y T010 resolvedor bloquean todo).
- US1 primero (candados y guardarraíl: base de seguridad).
- US2 → US3 (no hay a quién invitar sin organizaciones).
- US7 depende de Phase 2; su sección de Blueprint (T037) de T023.
- US8 depende de US2 (esqueleto del Blueprint) y de US7 (sección `modules`).
- US5 depende de US2 (Super-Admin) y del resolvedor; T051 de las rutas existentes.
- US4 y US6 dependen solo de Phase 2 y pueden ir en paralelo a US3/US5.
- US9 depende de US8 (servicio, REST y tokens: T043, T047). Es separable: si se aplazara, nada de lo anterior cambia.
- Phase 12 al final; T073 solo con CI/staging en verde.

## Estrategia

1. MVP: Phases 1–3 (modo plataforma con candados, `single` intacto) → commit.
2. US2 → US3 → US7 → US8 → US5 (núcleo SaaS, aprovisionamiento y su seguridad), un commit por historia.
3. US4 y US6 (marca y región por organización).
4. US9 (MCP, tras bandera).
5. Cierre y validación en staging con DNS comodín.
