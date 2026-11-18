# Implementation Plan: Multi-Tenant SaaS (modo plataforma)

**Branch**: `feat/069-multitenant-saas` | **Date**: 2026-11-17 (rev. 2) | **Spec**: [spec.md](spec.md)
**Estado**: borrador para aprobación — no se ha cambiado código.
**Aprobado por producto (rev. 1)**: D1, D2, D3, D4, D6, D7, D8, D9, D10.
**Nuevo en rev. 2**: D5 (dos niveles), D11 (módulos), D12 (Blueprint),
D13 (API de plataforma), D14 (tokens), D15 (MCP).

## Summary

Una bandera `TENANCY` decide el modo. En `single` nada cambia. En `multi`:
candados (registro cerrado, `/api/bot/*` 404, despacho apagado), un rol de
plataforma en tabla propia con panel `/platform`, invitaciones de un uso con
token hasheado, resolución de organización por subdominio (y por sesión en el
dominio raíz), marca sin sesión por host, región y **módulos por
organización** (las banderas de instancia pasan a ser techo), un acceso de
soporte con caducidad, **dos niveles** (`lectura` / `configuracion`) y
auditoría de cada petición, y **aprovisionamiento declarativo**
(`OrganizationBlueprint` v1) servido por UN servicio que consumen tres
fachadas: el asistente de `/platform`, la API REST `/api/platform/*` y un
**servidor MCP** opcional para IA. Una migración aditiva `0028_plataforma`.
Versión 2.9.0.

## Technical Context

**Language/Version**: TypeScript 5.9 (Next.js 15, React 19)
**Primary Dependencies**: Better Auth 1.6.23 (plugin `organization`), Drizzle, Zod 4 — **una dependencia nueva**: `@modelcontextprotocol/sdk` (solo la fase MCP, versión exacta fijada tras R2)
**Storage**: PostgreSQL 16 — migración aditiva `0028_plataforma`
**Testing**: Vitest con un worker (local), E2E `scripts/e2e-plataforma.mjs` en CI/staging
**Target Platform**: Coolify con dominio base y DNS/TLS comodín
**Constraints**: `single` idéntico a 2.8.0; equipo local sin build/Docker/Playwright; contratos `x-vocero-*` y `vocero:cerebro:v1` intactos
**Scale/Scope**: ~60 archivos de `src/` (incluye ~30 consumidores de banderas de módulo), 6 tablas/columnas nuevas, 2 contratos nuevos (Blueprint v1, OpenAPI de plataforma), 1 E2E nuevo

## Constitution Check

| # | Gate | Estado |
|---|---|---|
| I | Organización por host + membresía o sesión validada (FR-010), nunca «la primera»; soporte sin acceso por defecto, en dos niveles acotados, con caducidad y auditoría por petición; `configuracion` jamás alcanza credenciales, envío, contactos ni equipo; tokens (invitación y API) solo como hash; Blueprint y MCP sin secretos ni datos personales; prueba A↛B por superficie | ✅ |
| II | Sin servicios de terceros: sin email, sin OAuth externo. El SDK de MCP es una librería embebida y el servidor MCP es opcional, tras bandera apagada por defecto, con la plataforma completa operable sin él (panel + REST) | ✅ (dependencia justificada abajo) |
| III | Slug único sin valores cableados en `multi`; altas por la plataforma; región y módulos como datos de la organización | ✅ (ver Complexity Tracking) |
| IV | Blueprint declarativo e idempotente (bloqueo por organización, `sin_cambios` en la 2.ª aplicación, `dryRun`); aceptar invitación de un uso; crear con slug existente falla sin efectos | ✅ |
| V | Local: typecheck, lint, Vitest 1 worker. CI/staging: build + E2E | ✅ |
| VI | Ciclo completo (migración + contrato `/api/bot/*` + contratos nuevos) | ✅ |
| VII | Decisiones D1–D15 con su alternativa; R1 verificado, R2 por verificar antes de la fase MCP | ✅ |
| VIII | Administrar y aprovisionar organizaciones entra al alcance en `multi`; módulos ≠ planes; sin billing | ✅ |
| IX | E2E de plataforma en staging (feliz + infeliz, panel y MCP) | ✅ (pendiente staging) |
| X | Sin lógica de nicho; `modules` y Blueprint son el punto de entrada de los Vertical Packs como datos; `/api/bot/*` desaparece SOLO en `multi` | ✅ |
| XI | Región, marca y módulos por organización, cada uno por un solo módulo central | ✅ |
| Modo | Matriz `single`/`multi` en cada historia | ✅ |

**Dependencia nueva (II)**: `@modelcontextprotocol/sdk` — implementación de
referencia del protocolo (JSON-RPC, negociación, esquema de herramientas). Sin
red ni servicio externo; solo se carga en la ruta MCP. Si R2 falla (transporte
incompatible con Route Handlers), respaldo: manejador JSON-RPC sin estado
propio (`initialize`, `tools/list`, `tools/call`) sin la dependencia.

## Decisiones de diseño

**D1 — Bandera y dominio.** *(aprobada)* `src/lib/tenancy.ts`: `tenancy(): "single" | "multi"`,
`esPlataforma()`, `dominioBase()` (`PLATFORM_BASE_DOMAIN`, p. ej. `aliantis.co`).
Variables nuevas en `env.ts` sin validación que tumbe el arranque (patrón 068):
`TENANCY`, `PLATFORM_BASE_DOMAIN`, `PLATFORM_ADMIN_EMAILS`, `PLATFORM_MCP`.
`pnpm doctor`: ✗ si `multi` sin dominio base; aviso si `multi` sin
`PLATFORM_ADMIN_EMAILS`; aviso si `PLATFORM_MCP` encendida en `single`.

**D2 — Rol de plataforma en tabla propia; arranque por correo.** *(aprobada)* `platform_admin
(user_id PK → user, created_at, created_by)`. En `multi`, el registro acepta
SOLO correos de `PLATFORM_ADMIN_EMAILS` (y aceptaciones de invitación); al
crearse uno, se inserta en `platform_admin`. Quitar un correo de la variable no
revoca (la tabla manda).

**D3 — Cookies de un host; el host manda.** *(revisada tras staging)* La versión
inicial compartía la cookie (`crossSubDomainCookies` en el dominio base). En
staging: la sesión de un dueño en `{slug}.<base>` pisaba la del Super-Admin en la
raíz, y en dominios de la Public Suffix List (`*.sslip.io`) el navegador rechaza
`Domain=` compartido. Ahora cada host tiene su cookie; `trustedOrigins` sigue con
`{protocolo}//*.dominio` (R1). Para entrar a un negocio desde la raíz (`/empresas`,
«Abrir negocio», «Entrar» de soporte) la raíz emite un **pase** de un solo uso
(`server/platform/pase.ts`: HMAC con `BETTER_AUTH_SECRET`, ≤ 60 s, atado al host,
nonce en `verification` borrado al canjear, acceso re-verificado) que el
subdominio canjea en `/api/auth/pase/canjear` (plugin de Better Auth) creando la
sesión de ese host. La organización de CADA petición se resuelve por su host
(FR-010) y se valida contra la membresía; `session.activeOrganizationId` solo
decide en el dominio raíz.

**D4 — Un solo resolvedor de contexto.** *(aprobada)* `src/server/tenant/contexto.ts`:
`resolverContexto(headers)` → `{ kind: "organizacion", organizationId, role,
via: "miembro" | "soporte", grant?: { id, level, expiresAt }, modulos } |
{ kind: "plataforma" } | { kind: "ninguno" }`. Carga la fila de la
organización UNA vez por petición (estado, módulos, región) y la deja en el
contexto. `requireSession` (y por lo tanto `withAuth` y los layouts) pasa a
usarlo. En `single` devuelve lo de hoy (primera membresía) con `modulos` = techo.

**D5 — Soporte en dos niveles, auditado por petición.** *(rev. 2)*
`support_grant (id, organization_id, platform_user_id, level, reason,
expires_at, created_at, revoked_at, revoked_by)`, `level ∈ {lectura,
configuracion}`. Con grant vigente para la organización del host, el
Super-Admin resuelve `role: "soporte"` con `grant.level`.
- **Alcance declarado en la ruta, no en una lista aparte.** `withAuth` gana una
  opción `soporte?: "configuracion"`. Regla en `withAuth`: `soporte` +
  `GET`/`HEAD` → pasa; `soporte` + mutación → pasa SOLO si `grant.level ===
  "configuracion"` **y** la ruta declara `soporte: "configuracion"`; si no,
  403 `solo_lectura` (nivel `lectura`) o `fuera_de_alcance` (nivel
  `configuracion`). Por defecto ninguna ruta lo declara.
- **Rutas que lo declaran** (cerrado, comprobado por un guardarraíl que lista
  los archivos con la opción): `api/settings/branding`, `api/settings/appearance`,
  `api/pipeline/stages/**`, `api/calendar/settings`, `api/agent/profile`,
  `api/kb/**`. Explícitamente fuera: `settings/ai`, `settings/whatsapp`,
  `settings/team`, canales y conectores (`instagram`, `messenger`, `tiktok`,
  `google`, `zoom`, `capi`, `webhook`, `channels`), contactos, conversaciones,
  envío, leads, importación, Laboratorio, borrado de datos.
- **Auditoría**: cada petición `{action: "soporte_peticion", level, method,
  path, ip}`; cada mutación permitida añade `{changedKeys}` (nombres de campo,
  nunca valores). `canConfigure("soporte")` = `level === "configuracion"`
  (la UI muestra los editores permitidos, deshabilita el resto). Banda en
  `AppShell`: «Acceso de soporte (lectura|configuración) — vence HH:MM».
- *Alternativa descartada*: una lista central de prefijos de ruta permitidos —
  se desincroniza al mover rutas; la declaración en la ruta es local, grepeable
  y la prueba la vigila.

**D6 — Invitaciones sobre la tabla existente.** *(aprobada)* `invitation` gana
`token_hash` (único) y `accepted_at`. Token 32 bytes base64url mostrado UNA vez;
aceptar = transacción (hash, vigencia, `pending`, correo normalizado,
`runInternalSignup` si no existe, `member`, `accepted`).

**D7 — Suspensión.** *(aprobada)* `organization.status` (`activa` |
`suspendida`) + `suspended_at`; 403 `organizacion_suspendida`; ingesta sigue,
envío y despacho no.

**D8 — Slug.** *(aprobada)* Regla de FR-007, reservados en `tenancy.ts`
(`www`, `app`, `api`, `platform`, `admin`, `static`, `mail`, `soporte`,
`status`, `docs`, `mcp`), único, **inmutable**; `principal` se conserva.

**D9 — Región por organización en `metadata`.** *(aprobada)* `metadata.region =
{ country, locale, timezone }`; `getRegionDeOrganizacion(orgId)` = metadata ∪
`REGION_*`.

**D10 — Marca sin sesión por host.** *(aprobada)* `getBrandingContext` y
`aparienciaDelNegocio` sin organización: por host en `multi`, marca de
plataforma si no hay coincidencia; `single` igual.

**D11 — Módulos por organización: la instancia es el techo.** *(rev. 2)*
- **Dónde**: columna `organization.modules jsonb NULL` (no `metadata`, que es
  texto de Better Auth): `{ agenda?: boolean, atribucion?: boolean,
  channels?: Channel[], modules?: string[] }`. `null`/clave ausente = hereda.
- **Cálculo** (`src/server/modulos/efectivos.ts`, puro):
  `agenda = agendaEnabled() && (org.agenda ?? true)`; igual `atribucion`;
  `channels = enabledChannels() ∩ (org.channels ?? todos) ∪ {whatsapp}`;
  `modules = CATALOGO_VERTICAL ∩ (org.modules ?? [])` (los verticales son
  opt-in: no hay techo de instancia hasta la 071, el catálogo nace vacío).
  Las funciones actuales (`agendaEnabled`, `atribucionEnabled`,
  `enabledChannels`) NO cambian: pasan a ser «el techo».
- **Consulta**: `moduloActivo(ctx, "agenda" | "atribucion")` y
  `canalActivo(ctx, canal)` leen `ctx.modulos` (ya cargado por D4: cero
  consultas extra). Las ~30 superficies con organización que hoy llaman a la
  bandera de instancia se migran; las que no tienen organización (salud de la
  instancia, `/api/bot/*` de `single`) siguen con el techo. Webhooks de canal:
  resuelven la organización por su token y consultan `canalActivo`; apagado en
  la organización → 200 + descarte con log `canal_apagado_org`.
- **Guardarraíl** `tests/unit/modulos-por-organizacion.test.ts`: fuera de una
  lista corta de archivos permitidos (los propios `flag.ts`/`enabled.ts`,
  `efectivos.ts`, `health.ts`, `/api/bot/*`), ningún archivo de `src/app` ni
  `src/server` llama a `agendaEnabled()`, `atribucionEnabled()`,
  `isChannelEnabled(` o `enabledChannels()`.
- **UI**: `/platform/organizaciones/[id]` → pestaña Módulos (interruptores;
  los que el techo no permite, deshabilitados con «no disponible en esta
  instancia»). El `owner` NO cambia sus módulos (decisión de la agencia).
- *Alternativa descartada*: tabla `organization_module(org, key, enabled)` —
  más filas y joins por petición para 4 claves; el JSON tipado con Zod basta y
  el catálogo vertical se valida en código.

**D12 — `OrganizationBlueprint` v1: un servicio, tres fachadas.** *(rev. 2)*
- **Contrato** `src/lib/platform/blueprint.ts` (Zod `.strict()` en cada nivel →
  campos desconocidos = 422; exporta también el JSON Schema para el MCP y la
  OpenAPI):
  ```ts
  {
    version: 1,
    organization?: { slug /* solo al crear */, name },
    region?:   { country, locale, timezone },
    brand?:    { name?, accent?, currency? },          // metadata.branding
    modules?:  { agenda?, atribucion?, channels?, modules? },
    pipeline?: { stages: string[] },                   // etapas abiertas, en orden
    agent?:    { name?, tone?, role?, tools?, instructions?,
                 escalationRules?, greeting? },        // sin `enabled`
    knowledge?:{ mode: "merge" | "exact",
                 entries: ({ kind: "qa", question, answer }
                         | { kind: "block", content })[] },
    agenda?:   { weeklyHours, slotMinutes, bufferMinutes, minNoticeHours,
                 maxDaysAhead, timezone?, connector?: "enlace-fijo",
                 meetingLink? },
    owner?:    { email, regenerate?: boolean },
  }
  ```
  `role` y `tools` se validan contra `src/lib/agent-roles.ts` y el catálogo de
  herramientas; `weeklyHours` con el mismo validador de Ajustes → Agenda; zona
  IANA con el de `region.ts`. Límites de tamaño (p. ej. ≤ 500 entradas de
  conocimiento, ≤ 20 etapas) para que una IA no vuelque basura.
- **Servicio** `src/server/platform/blueprint/aplicar.ts`:
  `aplicarBlueprint(actor, objetivo, bp, { dryRun })` → una transacción con
  `pg_advisory_xact_lock(hashtext(orgId))`; un aplicador por sección
  (`secciones/*.ts`), cada uno `planificar(estadoActual, deseado) → cambios` y
  `ejecutar(tx, cambios)`. `dryRun` = solo planificar (y hace rollback).
  Semántica por sección:
  - *organization/region/brand/modules/agent/agenda*: merge de campos
    presentes; igual al actual → `sin_cambios`.
  - *pipeline*: por nombre normalizado; crea las que faltan, reordena; una
    etapa abierta ausente se borra solo si no tiene leads, si no se conserva +
    advertencia `etapa_con_leads_conservada`; anclas won/lost intactas.
  - *knowledge*: comparación normalizada (minúsculas, espacios colapsados);
    `merge` agrega faltantes; `exact` además borra sobrantes.
  - *owner*: si hay invitación pendiente vigente para ese correo y rol owner →
    `pendiente` sin URL; `regenerate` → revoca y emite una nueva; si el correo
    ya es miembro → `ya_miembro`.
  - *agenda* con módulo apagado → se guarda y advierte `modulo_apagado`.
- **Export** `exportarBlueprint(orgId)`: el inverso exacto (propiedad probada:
  `aplicar(exportar(org))` = `sin_cambios`).
- **Fachadas**: asistente de `/platform/nuevo` (pasos a–f construyen el
  Blueprint en el cliente; botones «Ver JSON» / «Importar JSON»); REST (D13);
  MCP (D15). Ninguna tiene lógica propia más allá de autenticar y traducir.
- **Auditoría**: `blueprint_aplicado` con `{sections, counts, warnings, dryRun}`
  — sin textos de conocimiento ni instrucciones.
- **Super-Admin sin grant de soporte puede aplicar Blueprints** ⚠️: aprovisionar
  es configuración, no datos personales; queda auditado y visible al `owner`
  en Ajustes → Equipo («Cambios de la plataforma»). Leer el Blueprint expone
  instrucciones y conocimiento del negocio (no datos de clientes).
  *Alternativa*: exigir grant `configuracion` también para Blueprints tras la
  entrega al `owner` — más estricto, pero rompe el flujo «la IA ajusta el
  agente del cliente» sin pedir acceso cada vez.
- *Alternativa descartada*: endpoints imperativos por sección
  (`POST /stages`, `POST /kb`…) para la IA — no idempotentes, N llamadas, y
  duplicarían la validación del panel.

**D13 — API REST de plataforma.** *(rev. 2)* `src/app/api/platform/**`
(rutas en inglés: es contrato público para máquinas; la UI sigue en español):
`GET/POST /organizations`, `GET /organizations/{idOrSlug}`,
`GET/PUT /organizations/{idOrSlug}/blueprint` (`?dryRun=true`),
`POST /organizations/{idOrSlug}/suspend` · `/reactivate` ·
`/invitations`, `GET /catalog` (roles, herramientas, canales del techo,
módulos verticales, zonas/locales aceptados — para que una IA no adivine).
`POST /organizations` = crear con Blueprint (`organization.slug` obligatorio).
Guardia única `requirePlataforma(req, { scope })`: sesión de Super-Admin
(vía `sesion`) **o** `Bearer` de `platform_api_token` (vía `api`); si no, 404.
Errores `{ error: código, path?, detail? }` estables. Contrato en
`docs/openapi-platform.json`.

**D14 — Tokens de API de plataforma (no una llave de instancia).** *(rev. 2)*
`platform_api_token (id, user_id, name, token_hash UNIQUE, last4, scopes,
expires_at, last_used_at, revoked_at, created_at)`. Formato `alp_` + 32 bytes
base64url, mostrado una vez. Alcances `read` (listar, exportar, planificar,
catálogo) y `provision` (además aplicar, crear, invitar, suspender/reactivar).
Gestión en `/platform/tokens` (crear, revocar; nunca re-mostrar).
*Alternativa descartada*: `PLATFORM_API_KEY` en el entorno — una credencial
compartida y anónima: la auditoría no sabría QUIÉN aprovisionó (Ley 1581,
Principio I), rotarla exige redeploy y no hay alcances. Con tokens por persona,
cada acción tiene actor y token identificables.

**D15 — Servidor MCP: adaptador fino dentro de la 069, última fase.** *(rev. 2)*
- **Dónde**: `src/app/api/platform/mcp/route.ts` (Streamable HTTP sin estado,
  POST JSON-RPC), mismo despliegue; bandera `PLATFORM_MCP` apagada por
  defecto (patrón ADR-001: 404 si apagada o en `single`). Autenticación: la
  misma guardia de D13 con `Bearer` (vía `mcp`).
- **Herramientas** (`src/server/platform/mcp/herramientas.ts`, cada una ≤ 20
  líneas que llaman al servicio): `get_catalog`, `list_organizations`,
  `get_organization`, `get_blueprint`, `plan_blueprint` (dryRun),
  `apply_blueprint`, `create_owner_invitation`, `suspend_organization`,
  `reactivate_organization`. El `inputSchema` de `apply/plan_blueprint` es el
  JSON Schema generado del Zod de D12 (una sola fuente). Suspender/reactivar
  marcadas como destructivas en sus anotaciones.
- **Fuera, a propósito**: soporte (grants), lectura de conversaciones/contactos,
  borrado, tokens.
- **Sin duplicar lógica**: prueba de equivalencia — el mismo Blueprint por REST
  y por MCP produce el mismo estado y la misma entrada de auditoría salvo `via`.
- **Clientes**: guía `docs/plataforma-mcp.md` con la configuración para Claude
  Code/Desktop y Gemini CLI (URL + cabecera `Authorization`). ChatGPT exige
  OAuth en sus conectores → fase posterior.
- *Alternativa descartada*: paquete/servicio MCP aparte (stdio) que llame a la
  REST — otro artefacto que desplegar y versionar; como adaptador dentro de la
  app comparte guardia, auditoría y validación sin red de por medio. Si más
  adelante se quiere stdio, será un cliente fino de la REST de D13.

**R1 (verificado)** — `better-auth@1.6.23` incluye `wildcardMatch` en
`trusted-origins`, `crossSubDomainCookies` y `/organization/set-active`.
**R2 (por verificar en T061)** — el SDK de MCP expone un transporte Streamable
HTTP sobre `Request`/`Response` web (Route Handler); si no, respaldo propio.

## Migración `0028_plataforma` (aditiva)

```sql
ALTER TABLE organization ADD COLUMN status text NOT NULL DEFAULT 'activa';
ALTER TABLE organization ADD COLUMN suspended_at timestamp;
ALTER TABLE organization ADD COLUMN modules jsonb;            -- null = hereda el techo
ALTER TABLE invitation  ADD COLUMN token_hash text UNIQUE;
ALTER TABLE invitation  ADD COLUMN accepted_at timestamp;
CREATE TABLE platform_admin (user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(), created_by text);
CREATE TABLE support_grant (id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  platform_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  level text NOT NULL,                                        -- 'lectura' | 'configuracion'
  reason text NOT NULL, expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT now(),
  revoked_at timestamp, revoked_by text);
CREATE INDEX support_grant_org_idx ON support_grant (organization_id, expires_at);
CREATE TABLE platform_api_token (id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL, token_hash text NOT NULL UNIQUE, last4 text NOT NULL,
  scopes jsonb NOT NULL, expires_at timestamp, last_used_at timestamp,
  revoked_at timestamp, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE platform_audit_log (id text PRIMARY KEY, actor_user_id text NOT NULL,
  organization_id text REFERENCES organization(id) ON DELETE SET NULL,
  via text NOT NULL DEFAULT 'sesion',                         -- 'sesion' | 'api' | 'mcp'
  token_id text, action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', ip text,
  created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX platform_audit_log_org_idx ON platform_audit_log (organization_id, created_at);
```
(SQL ilustrativo: se genera con `pnpm db:generate` desde `schema.ts`; los
enumerados se validan con Zod y `text({ enum })` como el resto del esquema.)
Una instalación `single` la recibe igual y no la usa (todo tras bandera).

## Project Structure

```text
specs/069-multitenant-saas/{spec,plan,tasks}.md
src/lib/tenancy.ts                       (nuevo) bandera, dominio, slug
src/lib/platform/blueprint.ts            (nuevo) contrato Zod + JSON Schema
src/server/tenant/{contexto,host}.ts     (nuevo) resolvedor único (D4)
src/server/modulos/efectivos.ts          (nuevo) techo ∧ organización (D11)
src/server/platform/                     (nuevo) admins, organizaciones,
                                          invitaciones, soporte, auditoria,
                                          tokens, guardia (requirePlataforma),
                                          blueprint/{aplicar,exportar,secciones/*},
                                          mcp/{servidor,herramientas}
src/app/(platform)/platform/...          (nuevo) lista, nuevo (asistente),
                                          detalle (módulos, invitar, suspender,
                                          Blueprint JSON), soporte, auditoría, tokens
src/app/api/platform/...                 (nuevo) REST (D13) + mcp/route.ts (D15)
src/app/(auth)/invitacion/[token]/       (nuevo) aceptar invitación
src/app/(app)/empresas/                  (nuevo) selector en dominio raíz
src/lib/auth/index.ts · session.ts       crossSubDomain, resolvedor
src/lib/api.ts                           soporte por niveles + auditoría
src/server/auth/{registration,on-signup}.ts   modo; siembra extraída
src/server/bot/auth.ts · brains/config.ts     candados de multi
src/server/{branding,apariencia}.ts      marca por host
~30 consumidores de banderas de módulo   → moduloActivo / canalActivo
src/lib/region.ts                        getRegionDeOrganizacion
src/lib/storage/medios.ts                comprobarSegmento
src/lib/db/schema.ts + drizzle/0028_*    migración
docs/openapi-platform.json · docs/plataforma-mcp.md
tests/unit/…                             puras, A↛B, guardarraíles, idempotencia
scripts/e2e-plataforma.mjs               E2E (CI/staging)
```

## Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Un camino que olvida el resolvedor y vuelve a «la primera organización» | Guardarraíl `sin-primera-organizacion` |
| Una superficie que sigue leyendo la bandera de instancia y enciende un módulo apagado en la organización | Guardarraíl `modulos-por-organizacion` + prueba por módulo (org apagada → 404) |
| `configuracion` alcanza más de lo debido | Alcance declarado por ruta, default cerrado; guardarraíl con la lista exacta de rutas que lo declaran; pruebas de 403 en envío, contactos, equipo y credenciales |
| Un Blueprint borra datos | Ninguna sección borra filas con datos dependientes (etapas con leads se conservan); `knowledge.exact` es opt-in; `dryRun` previo en el asistente y en el MCP |
| Divergencia panel / REST / MCP | Un servicio; prueba de equivalencia REST↔MCP; asistente que envía el mismo JSON |
| Token de API filtrado | Hash + últimos 4, alcances, caducidad, revocación inmediata, `last_used_at`, auditoría por llamada; sin herramientas sobre datos personales |
| Cookie compartida entre subdominios | El host decide la organización en cada petición y se valida la membresía |
| Romper `single` | SC-001: suite y E2E actuales sin cambios de expectativas; `modules = null` ⇒ techo |
| Tamaño de la 069 | Fases con commit propio; MVP = Fases 1–3; el MCP (Fase 11) es separable sin tocar lo anterior si hiciera falta |
| R2 (SDK MCP) | Verificación en el paquete antes de la fase; respaldo JSON-RPC propio |
| DNS/TLS comodín mal configurado | Verificación humana en staging; `doctor` comprueba la variable |

## Complexity Tracking

| Excepción | Por qué | Alternativa descartada |
|---|---|---|
| `platform_admin`, `platform_api_token` y `platform_audit_log` sin `organization_id NOT NULL` (III) | Son datos de la PLATAFORMA: un Super-Admin y sus tokens no pertenecen a una organización, y una entrada de auditoría puede no tenerla (alta de un admin, creación de token) | Colgarlos de una «organización de plataforma» ficticia: mezclaría datos de plataforma con datos de tenant y la volvería visible a sus miembros |
| Dependencia `@modelcontextprotocol/sdk` (II) | Implementar el protocolo MCP a mano es reimplementar la referencia; es librería embebida, sin red, cargada solo en la ruta opcional | Manejador propio: queda como respaldo si R2 falla |
