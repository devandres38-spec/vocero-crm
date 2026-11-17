# Feature Specification: Multi-Tenant SaaS (modo plataforma)

**Feature Branch**: `feat/069-multitenant-saas`
**Created**: 2026-11-17 · **Revisado**: 2026-11-17 (rev. 2: soporte en dos
niveles, módulos por organización, `OrganizationBlueprint`, servidor MCP)
**Status**: Draft — diseño pendiente de aprobación (no se ha cambiado código)
**Carril**: **Ciclo completo** (Principio VI): migración `0028` (tablas de
plataforma, estado y módulos de la organización), cambio de contrato publicado
(`/api/bot/*` responde 404 en modo plataforma) y contratos nuevos
(`OrganizationBlueprint` v1, `/api/platform/*`, servidor MCP).
**Constitución**: 2.0.0 (Principios I, II, III, IV, VIII, X, XI; Restricciones
«Registro por modo», «Superficies de organización única», «Marca sin sesión»).
**Repos**: `vocero-crm` (Nea no cambia en esta fase; se conecta en la 070).

## Problema

Hoy una instancia sirve a un solo negocio: el registro se cierra tras la
primera organización, el alta siembra siempre `slug: "principal"`, la sesión
toma la primera membresía del usuario, la API del cerebro (`/api/bot/*`) y las
pantallas sin sesión (login, manifest, favicon, icono) resuelven «la primera
organización», y la región y los módulos (`AGENDA`, `ATRIBUCION`, `CHANNELS`)
son solo de la instancia. Aliantis necesita operar N negocios en una sola
instancia, darlos de alta completos (marca, módulos, pipeline, agente,
conocimiento, agenda) desde un panel de agencia **o desde una IA** por un
contrato declarativo, entregar a cada uno su URL con su marca, y poder dar
soporte sin que la agencia lea conversaciones de clientes sin dejar rastro
(Ley 1581 de protección de datos personales).

## User Scenarios & Testing

### User Story 1 — Modo plataforma con candados (Priority: P1)

El operador despliega con `TENANCY=multi`: el registro público queda cerrado,
la API de organización única deja de existir y nada resuelve «la primera
organización». Con `TENANCY=single` (o sin la variable) todo es idéntico a la
2.8.0.

**Independent Test**: misma imagen con `TENANCY` vacía → la suite y los E2E
actuales en verde sin cambios. Con `TENANCY=multi` → `POST /api/auth/sign-up/email`
rechazado, `GET /api/bot/profile` 404 vacío, el despacho al cerebro inactivo.

**Acceptance Scenarios**:
1. **Given** `TENANCY` vacía o `single`, **When** se usa la instancia, **Then**
   registro, `/api/bot/*`, despacho, marca, módulos y sesión se comportan como
   en 2.8.0.
2. **Given** `TENANCY=multi`, **When** alguien llama a `/api/bot/*`, **Then**
   responde 404 sin cuerpo (igual que una bandera apagada), aunque traiga una
   `BOT_API_KEY` válida.
3. **Given** `TENANCY=multi`, **When** alguien intenta registrarse en `/register`
   sin una invitación ni ser un correo de `PLATFORM_ADMIN_EMAILS`, **Then** el
   registro se rechaza (aun con `ALLOW_SIGNUP=true`).
4. **Given** `TENANCY=multi` y `BRAIN_DISPATCH_URL` configurada, **When** entra
   un mensaje, **Then** NO se despacha (el despacho por organización llega en la
   070) y el mensaje queda en la bandeja.
5. **Given** un asset con id `..` o con `/`, **When** se calcula su ruta de
   medios, **Then** se rechaza (endurecimiento de `comprobarSegmento`).

### User Story 2 — Panel de agencia: crear y administrar organizaciones (Priority: P1)

Un Super-Admin de la plataforma entra a `/platform`, crea un negocio con un
asistente de alta (que produce un `OrganizationBlueprint`, US8), obtiene un
enlace de invitación para el primer `owner`, y puede suspender o reactivar el
negocio.

**Independent Test**: con `TENANCY=multi` y `PLATFORM_ADMIN_EMAILS=ops@…` →
registrarse con ese correo, crear «ferreteria-rojas», copiar el enlace de
invitación, suspender y reactivar; un usuario sin rol de plataforma recibe 404
en `/platform` y en `/api/platform/*`.

**Acceptance Scenarios**:
1. **Given** un correo listado en `PLATFORM_ADMIN_EMAILS`, **When** se registra
   en modo plataforma, **Then** queda como Super-Admin (sin organización) y su
   inicio es `/platform`.
2. **Given** el Super-Admin, **When** crea una organización con slug
   `ferreteria-rojas`, **Then** se crea con su pipeline y perfil del agente
   sembrados, su región y marca (por defecto la de `REGION_*`), sus módulos
   (por defecto, heredados del techo de la instancia) y estado `activa`; el
   slug queda inmutable.
3. **Given** un slug inválido, repetido o reservado (`www`, `app`, `api`,
   `platform`…), **When** se intenta crear, **Then** 422 con el motivo.
4. **Given** una organización creada, **When** el Super-Admin genera la
   invitación del `owner` (correo), **Then** obtiene UNA vez un enlace
   `https://{slug}.<dominio-base>/invitacion/{token}` válido 7 días y de un solo
   uso; en la base solo queda el hash del token.
5. **Given** una organización suspendida, **When** un miembro entra, **Then** ve
   «Organización suspendida» y la API responde 403 `organizacion_suspendida`;
   los webhooks se siguen guardando e ingiriendo (no se pierde ningún mensaje)
   pero no se envía nada ni se despacha. Al reactivar, todo vuelve.
6. **Given** un usuario que no es Super-Admin, **When** pide `/platform` o
   `/api/platform/*`, **Then** 404 (no 403: la superficie no se anuncia).

### User Story 3 — Invitación y varias empresas por usuario (Priority: P1)

El primer `owner` abre su enlace, crea su cuenta (o entra con la que ya tiene)
y queda dentro de su negocio. Un usuario que pertenece a dos negocios cambia
entre ellos sin cerrar sesión.

**Independent Test**: aceptar la invitación de «ferreteria-rojas» con un correo
nuevo → entra como `owner`; invitar ese mismo correo a «clinica-sol» → al
aceptar, el selector muestra las dos y cambiar de una a otra cambia bandeja,
marca, región y módulos.

**Acceptance Scenarios**:
1. **Given** un enlace vigente y un correo sin cuenta, **When** la persona pone
   nombre y contraseña, **Then** se crea su usuario (por el bypass interno del
   registro cerrado), queda `owner` de esa organización y entra a ella.
2. **Given** un correo que ya tiene cuenta, **When** abre el enlace, **Then**
   inicia sesión y la invitación se acepta sin tocar su contraseña.
3. **Given** un enlace vencido, usado, revocado o de otro correo, **When** se
   abre, **Then** se rechaza con un mensaje claro y no se crea nada.
4. **Given** un usuario miembro de A y B, **When** entra a `b.<dominio-base>`,
   **Then** la organización activa es B; en el dominio raíz ve un selector con
   sus empresas.
5. **Given** un usuario miembro solo de A, **When** entra a `b.<dominio-base>`,
   **Then** ve «No perteneces a este negocio» y ningún dato de B.
6. **Given** el `owner` de A agrega a su equipo un correo que ya existe en la
   plataforma, **When** guarda, **Then** se genera una invitación (no se le
   asigna la membresía sin que la acepte).

### User Story 4 — Marca por subdominio sin sesión (Priority: P2)

`ferreteria-rojas.aliantis.co/login` muestra el nombre, logo y colores de la
ferretería; `aliantis.co/login` (o un subdominio que no existe) muestra la
marca Aliantis.

**Acceptance Scenarios**:
1. **Given** `TENANCY=multi`, **When** se abre `{slug}.<dominio-base>/login`,
   `/manifest.webmanifest`, `/api/branding/favicon` o el icono de la app,
   **Then** salen con la marca de esa organización.
2. **Given** el dominio raíz o un slug inexistente o suspendido, **When** se
   abren esas superficies, **Then** salen con la marca de plataforma Aliantis
   (nunca la de «la primera organización»).
3. **Given** `TENANCY=single`, **When** se abren, **Then** se comportan como hoy.

### User Story 5 — Acceso de soporte auditado, en dos niveles (Priority: P1)

El Super-Admin no ve conversaciones, contactos ni mensajes de ningún negocio.
Para dar soporte pide un acceso con **nivel**, motivo y caducidad:
- **`lectura`**: solo peticiones `GET` (ver el negocio como lo ve su equipo).
- **`configuracion`**: lo anterior **más** modificar la configuración del
  negocio — marca y apariencia, pipeline, agenda, perfil del agente y base de
  conocimiento — con cada mutación auditada.

Ningún nivel permite enviar mensajes, editar contactos o conversaciones, tocar
el equipo, ni ver o cambiar credenciales (IA, WhatsApp, canales, conectores).

**Independent Test**: sin acceso, `GET {slug}/api/conversations` como
Super-Admin → 404; con acceso `lectura` de 2 h y motivo «Ticket 123» → 200 en
lecturas, 403 `solo_lectura` en cualquier escritura; con acceso
`configuracion` → `PUT /api/agent/profile` 200 (auditado con los campos
cambiados), `POST` de un mensaje → 403 `fuera_de_alcance`; cada petición
aparece en `/platform/auditoria`; al vencer o revocarlo → 404 otra vez.

**Acceptance Scenarios**:
1. **Given** un Super-Admin sin acceso vigente, **When** pide datos de dominio
   de una organización, **Then** 404, y el intento queda auditado.
2. **Given** una solicitud de acceso sin nivel válido, sin motivo (o motivo
   < 10 caracteres) o con caducidad > 8 h, **When** se envía, **Then** 422.
3. **Given** un acceso `lectura` vigente, **When** el Super-Admin navega el
   negocio, **Then** puede LEER (rol `soporte`), una banda visible dice «Acceso
   de soporte (lectura) — vence a las HH:MM», toda escritura responde 403
   `solo_lectura`, y cada petición queda en `platform_audit_log` (quién,
   organización, nivel, método, ruta, IP, cuándo).
4. **Given** un acceso `configuracion` vigente, **When** el Super-Admin cambia
   el perfil del agente, una etapa del pipeline, la agenda, la marca o una
   entrada de conocimiento, **Then** se aplica y la auditoría guarda la acción
   y los campos cambiados (sin el contenido de credenciales); **When** intenta
   una escritura fuera de esa lista (enviar, contactos, equipo, credenciales),
   **Then** 403 `fuera_de_alcance`.
5. **Given** el acceso de soporte de la organización A, **When** el Super-Admin
   pide datos de B, **Then** 404 (un acceso nunca abre otra organización).
6. **Given** un acceso, **When** vence o se revoca, **Then** se corta en la
   siguiente petición y queda auditado.
7. **Given** el `owner` de la organización, **When** entra a Ajustes → Equipo,
   **Then** ve los accesos de soporte a SU negocio (quién, nivel, motivo,
   cuándo) y los cambios que la plataforma aplicó por Blueprint.

### User Story 6 — Región por organización (Priority: P2)

Cada negocio tiene su país, locale y zona además de su moneda; la instancia
solo pone los valores iniciales.

**Acceptance Scenarios**:
1. **Given** una organización creada con país MX, locale `es-MX`, zona
   `America/Mexico_City`, **When** su equipo usa la app, **Then** fechas,
   números, teléfonos locales de importación y la zona por defecto de su agenda
   y de Resultados son de México, aunque la instancia sea de Colombia.
2. **Given** una organización sin región guardada (las existentes), **When** se
   usa, **Then** hereda `REGION_*` (comportamiento 2.8.0).
3. **Given** el `owner`, **When** cambia país/locale en Ajustes → Marca,
   **Then** se guarda en su organización y no afecta a otras.

### User Story 7 — Módulos por organización (Priority: P1)

Las variables de la instancia (`AGENDA`, `ATRIBUCION`, `CHANNELS`) pasan a ser
el **techo**: lo que el despliegue soporta. Cada organización enciende o apaga
sus propios módulos dentro de ese techo desde `/platform` (o por Blueprint).
Queda preparado un catálogo de módulos verticales (`modules: string[]`) para
los nichos de la 071+.

**Independent Test**: instancia con `AGENDA=on`, `CHANNELS=whatsapp,instagram`;
«clinica-sol» con agenda encendida e Instagram, «ferreteria-rojas» con agenda
apagada y solo WhatsApp → la clínica ve Citas e Instagram; la ferretería no ve
Citas, `GET /api/bookings` le responde 404 y su Ajustes no muestra Instagram.

**Acceptance Scenarios**:
1. **Given** una organización sin módulos guardados (todas las de `single` y
   las existentes), **When** se usa, **Then** sus módulos efectivos son
   exactamente el techo de la instancia (comportamiento 2.8.0).
2. **Given** un módulo encendido en la organización pero apagado en la
   instancia, **When** se usa, **Then** está apagado (el techo manda) y
   `/platform` lo muestra como «no disponible en esta instancia».
3. **Given** un módulo apagado en la organización, **When** su equipo pide su
   pantalla o su API, **Then** 404, igual que hoy con la bandera de instancia
   apagada; los webhooks de un canal apagado en la organización se reconocen
   (200) y se descartan con registro, sin crear contacto ni conversación.
4. **Given** WhatsApp, **When** se intenta apagar en una organización, **Then**
   422: es el canal núcleo y siempre está encendido.
5. **Given** `modules` con una clave que no está en el catálogo de módulos
   verticales del código, **When** se guarda, **Then** 422 `modulo_desconocido`
   (en la 069 el catálogo está vacío).
6. **Given** la organización A, **When** el Super-Admin cambia sus módulos,
   **Then** los de B no cambian (A↛B).

### User Story 8 — Aprovisionamiento completo por `OrganizationBlueprint` (Priority: P1)

El Super-Admin (desde el asistente de `/platform` o por API) describe un negocio
completo en un documento declarativo e idempotente y la plataforma lo deja
listo en una sola transacción: info y región, marca, módulos, etapas del
pipeline, agente (perfil completo) y conocimiento, agenda, e invitación del
`owner`.

**Independent Test**: `PUT /api/platform/organizations/ferreteria-rojas/blueprint`
con un Blueprint completo → 200 con el resumen de cambios y el enlace de
invitación; repetir el MISMO `PUT` → 200 con todas las secciones
`sin_cambios`, sin filas nuevas ni invitación nueva; `?dryRun=true` con un
cambio → devuelve el plan y la base no cambia; `GET` de la misma ruta devuelve
un Blueprint que, aplicado, no cambia nada.

**Acceptance Scenarios**:
1. **Given** un Blueprint válido para un slug nuevo, **When** se envía a
   `POST /api/platform/organizations`, **Then** se crea la organización con
   todas sus secciones en una transacción; si cualquier sección falla, no se
   crea nada.
2. **Given** un Blueprint aplicado, **When** se aplica de nuevo idéntico,
   **Then** el resultado es `sin_cambios` en cada sección y la base queda
   igual (idempotencia, Principio IV).
3. **Given** un Blueprint que solo trae `agent`, **When** se aplica, **Then**
   solo cambia el agente: las secciones ausentes no se tocan.
4. **Given** `pipeline.stages` sin una etapa que hoy tiene leads, **When** se
   aplica, **Then** la etapa se conserva y la respuesta trae la advertencia
   `etapa_con_leads_conservada` (nunca se borran datos por un Blueprint); las
   anclas «Ganado»/«Perdido» siempre se conservan.
5. **Given** `knowledge.mode = "merge"` (default), **When** se aplica, **Then**
   solo se agregan las entradas que no existen (comparación normalizada);
   con `mode = "exact"`, además se borran las que no están en el Blueprint.
6. **Given** `owner.email` con una invitación pendiente vigente, **When** se
   aplica, **Then** no se genera otra (la respuesta dice `invitacion:
   "pendiente"`, sin URL); con `owner.regenerate = true`, se revoca la anterior
   y se devuelve un enlace nuevo UNA vez.
7. **Given** un Blueprint con un campo desconocido, una herramienta de agente
   fuera del catálogo, un rol inválido, una zona IANA inválida o horarios
   solapados, **When** se envía, **Then** 422 con la ruta exacta del error.
8. **Given** un Blueprint con cualquier credencial (llave de IA, token de
   WhatsApp…), **When** se envía, **Then** 422: el Blueprint nunca transporta
   secretos (IA BYOK y WhatsApp los conecta el negocio).
9. **Given** cada aplicación, **When** termina, **Then** queda en
   `platform_audit_log` (actor, vía `sesion`|`api`|`mcp`, secciones cambiadas,
   conteos; sin el texto del conocimiento ni de las instrucciones).

### User Story 9 — Servidor MCP de aprovisionamiento para IA (Priority: P2)

Un cliente MCP autorizado (Claude, Gemini CLI, ChatGPT con conector) se conecta
a `https://<dominio-base>/api/platform/mcp` con un token de Super-Admin y puede
listar negocios, leer y planificar Blueprints, aplicarlos y generar la
invitación del `owner`, usando EXACTAMENTE los mismos servicios que el panel y
la API REST; todo queda auditado con vía `mcp`.

**Independent Test**: con `PLATFORM_MCP=on`, crear un token con alcance
`provision` en `/platform/tokens`; un cliente MCP llama `tools/list` → ve las
herramientas; `plan_blueprint` → diff sin escribir; `apply_blueprint` → negocio
creado; la auditoría muestra las acciones con vía `mcp` y el nombre del token.
Sin token, con token revocado o con `PLATFORM_MCP` apagada → 401/404.

**Acceptance Scenarios**:
1. **Given** `PLATFORM_MCP` apagada (default) o `TENANCY=single`, **When** se
   pide `/api/platform/mcp`, **Then** 404.
2. **Given** un token con alcance `read`, **When** llama `apply_blueprint`,
   **Then** error de permiso y auditado; `list_organizations`,
   `get_blueprint`, `plan_blueprint` y `get_catalog` sí responden.
3. **Given** un token revocado o vencido, **When** se usa, **Then** 401 y
   auditado.
4. **Given** cualquier herramienta MCP, **When** se ejecuta, **Then** no
   existe ninguna que lea conversaciones, contactos o mensajes, ni que otorgue
   accesos de soporte (eso es solo humano, desde el panel).
5. **Given** un token, **When** se crea, **Then** se muestra UNA vez; en la base
   solo quedan su hash y sus últimos 4 caracteres.

### Edge Cases

- `TENANCY=multi` sin `PLATFORM_BASE_DOMAIN`: el arranque no se cae; la marca sin
  sesión es siempre la de plataforma, la organización solo sale de la sesión, y
  `pnpm doctor` lo marca ✗.
- Una instancia `single` con datos que pasa a `multi`: su organización (slug
  `principal`) sigue funcionando en `principal.<dominio-base>` con los módulos
  heredados del techo; se documenta en el CHANGELOG.
- Un Super-Admin que además es miembro de una organización: en esa organización
  actúa con su rol de miembro, no con el de soporte.
- Dos pestañas en dos subdominios del mismo usuario: cada petición resuelve su
  organización por su host, no por la última que se activó.
- Invitación a un correo con mayúsculas o espacios: se normaliza (minúsculas,
  sin espacios) al crear y al aceptar.
- El operador baja el techo (quita `AGENDA`) con organizaciones que la tenían
  encendida: queda apagada para todas sin perder su configuración; al volver a
  subir el techo, vuelve como estaba.
- Dos aplicaciones concurrentes del mismo Blueprint: se serializan por
  organización (bloqueo transaccional) y la segunda resulta `sin_cambios`.
- Un Blueprint con `agenda` para una organización con el módulo agenda apagado:
  se guarda (inerte) y la respuesta advierte `modulo_apagado`.

## Requirements

### Functional Requirements

- **FR-001** `TENANCY` (`single` | `multi`, default `single`; valor inválido →
  `single` + aviso en `pnpm doctor`) se lee en un único módulo
  (`src/lib/tenancy.ts`).
- **FR-002** En `multi`: registro público cerrado siempre (se ignora
  `ALLOW_SIGNUP`), salvo correos de `PLATFORM_ADMIN_EMAILS` y aceptación de
  invitaciones; `onUserCreated` no crea organizaciones.
- **FR-003** En `multi`: `requireBotKey` responde 404 vacío antes de validar la
  llave; `despachoActivo()` es falso.
- **FR-004** `comprobarSegmento` rechaza `.`, `..` y cualquier segmento con `/`
  o `\`, además de lo que hoy rechaza.
- **FR-005** Rol de plataforma `superadmin` en una tabla propia
  (`platform_admin`), separado de `member.role`.
- **FR-006** `/platform` (UI) y `/api/platform/*` existen solo en `multi` y solo
  para Super-Admin (sesión o token de API); para cualquier otro, 404.
- **FR-007** Alta de organización: slug `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$`,
  no reservado, único, inmutable; siembra pipeline y perfil (la misma siembra de
  `onUserCreated`, extraída); el resto sale del Blueprint (FR-016).
- **FR-008** Invitaciones: token aleatorio de 32 bytes, solo su SHA-256 en BD,
  7 días, un uso, ligadas a organización + correo + rol; aceptación por
  `/invitacion/[token]`.
- **FR-009** Estado de organización `activa` | `suspendida`; suspendida bloquea
  UI y API de sus miembros (403 `organizacion_suspendida`), envío y despacho,
  pero no la ingesta de webhooks.
- **FR-010** Resolución de organización por petición, en este orden: (1) host
  `{slug}.<PLATFORM_BASE_DOMAIN>` → la organización debe existir, estar activa y
  el usuario debe ser miembro (o tener acceso de soporte vigente); (2) en el
  dominio raíz, `session.activeOrganizationId` validada contra la membresía;
  (3) nada → selector o `/platform`. Nunca «la primera organización».
- **FR-011** Acceso de soporte: tabla `support_grant` con `level`
  (`lectura` | `configuracion`), motivo ≥ 10 caracteres, caducidad ≤ 8 h,
  revocable; rol efectivo `soporte`. `lectura` = solo `GET`. `configuracion` =
  `GET` + las mutaciones de las rutas que declaran alcance de soporte
  `configuracion` (marca/apariencia, pipeline, agenda, perfil del agente,
  conocimiento); toda otra escritura → 403 (`solo_lectura` |
  `fuera_de_alcance`). Cada petición bajo soporte, cada intento sin acceso y
  cada alta/revocación/vencimiento se escribe en `platform_audit_log`; las
  mutaciones guardan además las claves cambiadas.
- **FR-012** Región por organización en `organization.metadata.region`
  (`country`, `locale`, `timezone`); `getRegionDeOrganizacion(orgId)` la combina
  con `REGION_*`; `RegionProvider`, importación de contactos, agenda y
  Resultados la usan.
- **FR-013** Marca sin sesión (login, layout raíz, manifest, favicon, icono de
  app, apariencia) resuelta por host en `multi`; marca de plataforma si no hay
  coincidencia.
- **FR-014** Toda superficie nueva lleva prueba de cruce A↛B (Principio I).
- **FR-015** Módulos por organización en `organization.modules` (`agenda`,
  `atribucion`, `channels`, `modules`); `null` o clave ausente = hereda el
  techo. Módulo efectivo = techo de instancia ∧ valor de la organización;
  WhatsApp siempre encendido; `modules` validado contra un catálogo del código.
  Toda superficie con organización pregunta por el módulo efectivo
  (`moduloActivo(ctx, …)`), nunca por la bandera de instancia directa
  (guardarraíl).
- **FR-016** `OrganizationBlueprint` v1: contrato Zod estricto (rechaza campos
  desconocidos y secretos) con secciones opcionales `organization`, `region`,
  `brand`, `modules`, `pipeline`, `agent`, `knowledge`, `agenda`, `owner`.
  Semántica declarativa por sección (ausente = no tocar), aplicación en una
  transacción con bloqueo por organización, idempotente, con `dryRun`, y
  respuesta `{ organizationId, slug, created, sections: {…: "sin_cambios" |
  "actualizada" | "creada"}, warnings[], invitation? }`. `GET` exporta el
  Blueprint vigente.
- **FR-017** API REST `/api/platform/*` (Zod, JSON, códigos estables):
  `GET/POST /organizations`, `GET /organizations/{idOrSlug}`,
  `GET/PUT /organizations/{idOrSlug}/blueprint` (`?dryRun=true`),
  `POST /organizations/{idOrSlug}/suspend|reactivate`,
  `POST /organizations/{idOrSlug}/invitations`, `GET /catalog`; documentada en
  `docs/openapi-platform.json`.
- **FR-018** Tokens de API de plataforma: por Super-Admin, nombre, alcances
  (`read` | `provision`), caducidad opcional, revocables; solo hash + últimos 4
  en BD; `Authorization: Bearer`; `last_used_at`. Sirven para REST y MCP.
- **FR-019** Servidor MCP en `/api/platform/mcp` (Streamable HTTP, sin estado),
  detrás de `PLATFORM_MCP` (apagado por defecto, 404) y solo en `multi`; sus
  herramientas son adaptadores finos de los servicios de `src/server/platform/`
  (sin lógica propia); ninguna lee datos personales ni otorga soporte.
- **FR-020** Toda acción de plataforma registra en `platform_audit_log` su vía
  (`sesion` | `api` | `mcp`) y el token usado, si lo hubo.

### Key Entities

- **`organization`** (+`status`, +`suspended_at`, +`modules`; `metadata.region`).
- **`platform_admin`**: usuario con rol de plataforma.
- **`invitation`** (existente, +`token_hash`, +`accepted_at`): invitación a una
  organización con un rol.
- **`support_grant`** (+`level`): acceso de soporte de un Super-Admin a una
  organización.
- **`platform_api_token`**: credencial de máquina de un Super-Admin (REST/MCP).
- **`platform_audit_log`** (+`via`, +`token_id`): rastro de toda acción de
  plataforma.
- **`OrganizationBlueprint`** (contrato, no tabla): descripción declarativa de
  un negocio.

### Tenancy, Localización y Marca

- **Modo**: todo lo nuevo existe solo en `multi`; `single` = 2.8.0.
- **Aislamiento**: es el objetivo de la feature; FR-010, FR-011, FR-014, FR-015.
- **Nicho**: núcleo (plataforma), sin lógica de nicho; `modules` y el Blueprint
  son el punto de entrada de los Vertical Packs (071+) como datos (X).
- **Localización/marca**: región y marca por organización resueltas por host o
  sesión (Principio XI).

## Success Criteria

- **SC-001** Con `TENANCY` vacía, la suite completa y los E2E de 2.8.0 pasan sin
  modificar sus expectativas.
- **SC-002** Con `TENANCY=multi`, ninguna ruta del código resuelve «la primera
  organización» ni consulta una bandera de módulo de instancia donde hay
  organización (guardarraíles que escanean `src/`).
- **SC-003** Cada superficie nueva tiene su prueba A↛B; la de soporte prueba que
  un acceso a A no abre B, y que `configuracion` no alcanza envío, contactos,
  equipo ni credenciales.
- **SC-004** Aplicar dos veces el mismo Blueprint produce `sin_cambios` en
  todas las secciones y cero filas nuevas (prueba automatizada).
- **SC-005** Panel, REST y MCP producen la misma organización a partir del mismo
  Blueprint (un solo servicio; prueba de equivalencia REST↔MCP).
- **SC-006** E2E de plataforma en staging: alta de 2 negocios por Blueprint
  (uno por panel, otro por MCP), invitación, aceptación, cambio de empresa,
  módulos distintos, suspensión, marca por subdominio y soporte auditado en
  ambos niveles.

## Qué se decidió NO hacer (y por qué)

- **Sin envío de correos**: la invitación es un enlace que el Super-Admin copia
  (Principio II: el núcleo no depende de un servicio de email).
- **Sin dominio propio por organización** (fase posterior, decidido en 067).
- **Sin billing, planes ni límites de uso** (Principio VIII). Los módulos por
  organización son interruptores operativos, no planes de cobro.
- **Sin renombrar slugs**: el slug viaja en el contrato del despacho
  (`x-vocero-organization`); cambiarlo es diseño de la 070 en adelante.
- **Sin `/api/brains/*` ni despacho por organización** (070). En `multi`, hasta
  la 070, los negocios operan su bandeja a mano; el Blueprint no enciende el
  agente (`agent.enabled` no existe en el contrato).
- **Sin secretos en el Blueprint, el panel ni el MCP**: llaves de IA (BYOK),
  tokens de WhatsApp y de canales los conecta el negocio.
- **Sin borrar organizaciones** desde el panel, la API ni el MCP (solo
  suspender): borrar datos personales exige su propio flujo (Ley 1581).
- **Sin herramientas MCP sobre datos personales ni sobre soporte**.
- **Sin OAuth para el MCP** en esta fase: autenticación por token Bearer
  (sirve a Claude Code/Desktop y Gemini CLI); los conectores que exigen OAuth
  (p. ej. ChatGPT) quedan para una fase posterior.
- **Sin módulos verticales reales**: el catálogo `modules` nace vacío; los
  llena la 071+.
- **Sin purga automática de la auditoría** en esta fase.

## Assumptions

- La plataforma usa un dominio base con DNS comodín (`*.aliantis.co`) y un
  certificado comodín en Coolify/Traefik (reto DNS-01); es requisito de
  despliegue, verificado por el responsable en staging.
- Better Auth 1.6.23 (instalada) soporta `trustedOrigins` con comodín,
  `crossSubDomainCookies` y `organization/set-active` (verificado en el
  paquete).
- El SDK oficial de MCP para TypeScript ofrece un transporte Streamable HTTP
  compatible con los `Request`/`Response` de un Route Handler de Next.js; se
  verifica en el paquete antes de usarlo (R2 del plan), con un respaldo sin
  dependencia.
