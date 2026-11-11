# 075 — RLS en Vocero (bloque H, paso 4.5, solo)

**Estado:** aprobada por Andres y programada con su «arranca» (11-nov-2026). Decisión base: D15 de Aliantis (rol de base sin `BYPASSRLS`, `withOrg()` con `set_config` local en cada transacción, un rol de sistema para los procesos de fondo, políticas en toda tabla con `organization_id` y prueba de aislamiento en la base). Mismo patrón que ya corre en `aliantis-brain` (`drizzle/0001_rls.sql`, `withOrganization`, `rlsBypassReasons`, funciones `SECURITY DEFINER` que solo devuelven ids).

## Lo verificado en el código (11-nov-2026, `main` en `6baa07b`)

**La base hoy**
- **Sin RLS:** ninguna tabla tiene políticas; el aislamiento es solo `scoped()` en el código (176 usos).
- **Un solo usuario de base:** la app y las migraciones usan la misma `DATABASE_URL`, que en `docker-compose.yml` es `postgres`, el superusuario. Las migraciones corren al arrancar el contenedor (`CMD node migrate.mjs && node server.js`).
- **Cliente:** `src/lib/db/index.ts` crea un solo cliente `postgres` (postgres-js, 10 conexiones) y `getDb()` lo envuelve con Drizzle. Hay **251 llamadas a `getDb()` en 107 archivos**, y solo 9 transacciones explícitas.
- **Lo que Drizzle usa del cliente** (`drizzle-orm/postgres-js/session.js`, 0.45.4): solo `client.unsafe(query, params)`, `client.begin(fn)` y `savepoint`. Esto permite fijar el negocio **debajo** de Drizzle sin tocar las 251 llamadas (D3).
- **CLI con conexión propia:** `meta:secreto`, `negocio:alta`, `privacidad:sembrar`, `avisos:grupo` y `seed:demo` crean su propio `drizzle(postgres(DATABASE_URL))`. Lo mismo hacen `migrate.mjs` y los arneses E2E.

**Inventario de tablas (42 en `schema.ts`)**

| Grupo | Tablas | `organization_id` |
| --- | --- | --- |
| Dominio | `contact`, `pipeline_stage`, `lead`, `lead_stage_event`, `conversation`, `message`, `media_asset`, `meta_credentials`, `meta_app`, `instagram_credentials`, `messenger_credentials`, `tiktok_credentials`, `agent_profile`, `kb_entry`, `template`, `agent_test_run`, `agent_test_case`, `calendar_settings`, `booking`, `offered_slot`, `zoom_credentials`, `google_credentials`, `ad_attribution`, `conversion_event`, `capi_settings`, `ai_credentials`, `dispatch`, `webhook_event`, `quick_reply`, `conversation_note`, `privacy_profile`, `consent`, `olvido_pendiente`, `aviso_canal` (es su clave primaria), `aviso_traspaso` (35) | Sí, `NOT NULL` en todas |
| Membresía (Better Auth) | `member`, `invitation` (2) | Sí, `NOT NULL` |
| El negocio | `organization` (1) | Es su `id` |
| Cuentas (Better Auth) | `user`, `session`, `account`, `verification` (4) | No (`session.active_organization_id` es opcional y no se usa para aislar) |

**Puntos que corren antes de saber el negocio, o sobre varios**

| Punto | Hoy | Archivo |
| --- | --- | --- |
| Login y sesión | El adaptador de Better Auth lee `user`, `session`, `account` y `verification` | `src/lib/auth/index.ts` |
| Negocio de la sesión | `resolveMembership(userId)` lee `member` por usuario | `src/server/auth/on-signup.ts` |
| Rutas de sesión | `withAuth` (casi todas las de `/api`), más 8 páginas y layouts del servidor y `/api/events` | `src/lib/api.ts`, `src/app/(app)/…`, `src/app/page.tsx` |
| Rutas del cerebro | `requireBot` devuelve el negocio; la ruta consulta después | 16 rutas de `src/app/api/bot/` |
| Negocio de un webhook | `resolverOrganizacion` y `organizacionesDeLaEntrega` buscan en `meta_credentials`, `instagram_credentials`, `messenger_credentials` y Zernio **entre todos los negocios** | `src/server/webhooks/organizacion.ts`, `zernio/conexiones.ts` |
| Auth del cerebro | `organizacionExiste` y `hastaDosOrganizaciones` leen `organization` | `src/server/bot/organizaciones.ts` |
| Worker del despacho | `tomarPendientes`, la próxima cita (`worker.ts:195`), olvidos (`reintentarOlvidos`) y avisos (`enviarAvisosPendientes`), todos entre negocios | `src/server/dispatch/`, `src/server/avisos/` |
| Worker de webhooks | barrido de pendientes, purga y `conteoGlobal` (para `/api/health`) | `src/server/webhooks/eventos.ts`, `worker.ts`, `src/server/health.ts` |
| Retención | `negociosConRetencion` recorre `privacy_profile` | `src/server/retencion/aplicar.ts` |
| Arranque | corridas huérfanas del Laboratorio y cifrado de secretos viejos de Zernio, sobre todos los negocios | `src/instrumentation-node.ts`, `zernio/secreto-guardado.ts` |
| Laboratorio | `startRun(org)` sigue en segundo plano tras responder | `src/server/lab/runner.ts` |
| Marca sin sesión | **Hallazgo:** el login, el favicon y el manifiesto sin sesión toman la marca de **«la primera organización» de la tabla**. Con varios clientes, el login de uno muestra el logo y el nombre de otro | `src/server/branding.ts`, `apariencia.ts`, `(auth)/layout.tsx`, `api/branding/favicon` |
| Alta | `crearNegocio` busca slugs ocupados entre todos los negocios | `src/server/auth/alta.ts` |
| CLI | `negocio:alta`, `meta:secreto`, `privacidad:sembrar`, `avisos:grupo`, `seed:demo` | `scripts/` |
| Mocks de desarrollo | `wa-mock/status` busca un mensaje por `wa_message_id` entre negocios; `inbound`, `echo` y `retencion` llaman código del servidor | `src/app/api/dev/` |

**El cerebro** ya tiene RLS en su esquema (`cerebro`) con su propio rol (`cerebro_app`). Vocero no le da permisos a ese esquema, y el cerebro tampoco a las tablas de Vocero.

## Decisiones propuestas

**D1 Qué tablas llevan RLS (38 de 42)**
- **Las 37 con `organization_id`** (dominio y membresía): `ENABLE ROW LEVEL SECURITY` y una política `FOR ALL` con `USING` y `WITH CHECK` iguales:
  ```sql
  organization_id = NULLIF(current_setting('app.organization_id', true), '')
  ```
- **`organization`:** la misma política sobre su `id`. Así un negocio no ve el nombre, la marca ni la apariencia de otro.
- **`user`, `session`, `account`, `verification`: sin RLS,** y se documenta por qué. No tienen `organization_id`, y Better Auth las lee antes de saber el negocio (iniciar sesión es buscar un usuario por correo). No guardan datos de pacientes. Su aislamiento sigue en el código: la lista del equipo une `user` con `member`, y `member` sí filtra.
- **Sin `FORCE ROW LEVEL SECURITY`.** Las tablas son del rol de migraciones. `FORCE` obligaría también al dueño, y entonces las funciones `SECURITY DEFINER` de D5 dejarían de poder listar ids entre negocios. La protección contra el dueño es otra: la app nunca se conecta como dueño, y si lo hace no arranca (D2).
- Sin negocio fijado, `current_setting(…, true)` es `NULL`, o `''` si la variable se definió antes en la sesión. `NULLIF(…, '')` trata los dos casos igual (ajuste de Andres): no se ve ni se escribe nada.

**D2 Roles**
- **`vocero_app`:** rol de grupo, `NOLOGIN NOBYPASSRLS`. Tiene `SELECT, INSERT, UPDATE, DELETE` sobre las tablas de `public` (y `ALTER DEFAULT PRIVILEGES` para las futuras), `EXECUTE` sobre las funciones de D5 y nada más (ni `CREATE` ni `TRUNCATE`). Lo crea la migración `0033`.
- **El usuario de la app** (`DATABASE_URL`): con `LOGIN`, miembro de `vocero_app`, `NOSUPERUSER NOBYPASSRLS` y sin ser dueño de ninguna tabla.
- **El rol de migraciones** (`DATABASE_MIGRATIONS_URL`, nueva): el dueño de las tablas, el que hoy es `postgres`. Solo lo usa `migrate.mjs` al arrancar el contenedor.
- **Al arrancar** (`instrumentation-node.ts`), la app revisa con qué usuario se conectó, como `rlsBypassReasons` del cerebro: superusuario, `BYPASSRLS`, dueño de alguna tabla o una tabla con `organization_id` sin RLS.
  - **En producción** (`NODE_ENV=production`), cualquiera de esos motivos impide arrancar: sale con un mensaje claro y sin la URL.
  - **En desarrollo** solo avisa.
- **No hay «rol de sistema» con `BYPASSRLS`.** Los procesos de fondo descubren su trabajo con las funciones de D5 (solo ids) y después trabajan negocio por negocio, como el cerebro.

**D3 El negocio en cada transacción (`conNegocio`)**
- **El contexto:** un `AsyncLocalStorage` en `src/lib/db/contexto.ts` guarda el negocio (`conNegocio(org, fn)`) o el modo sistema (`comoSistema(motivo, fn)`). El id se valida con `/^[A-Za-z0-9_-]{1,128}$/`, como `assertOrganizationId` del cerebro.
- **El cliente que ve Drizzle** (`getDb()`) es un envoltorio del cliente `postgres`. Con un negocio en el contexto:
  - **cada consulta suelta** (`unsafe`) corre como `begin` → `select set_config('app.organization_id', $org, true)` → la consulta → `commit`. Las dos sentencias van en *pipeline* en el mismo viaje, con el `begin(sql => [...])` de postgres-js;
  - **cada `db.transaction`** corre su `begin` con el mismo `set_config` primero; los `savepoint` quedan dentro.
- **`is_local = true` siempre**, dentro de una transacción: al terminarla, Postgres borra el valor. La conexión vuelve al pool sin negocio, así que nunca se filtra entre peticiones.
- **Modo sistema:** las consultas corren sin `set_config`. Por RLS no ven ninguna tabla de dominio, así que solo sirven para las cuentas de Better Auth y las funciones de D5.
- **Sin contexto, la consulta lanza `ConsultaSinNegocio`** antes de llegar a la base (pregunta 1). Con RLS, una consulta sin negocio devolvería vacío en silencio, y eso esconde errores: un worker que «no encuentra trabajo», un webhook «sin negocio».
- **Un `conNegocio(B)` dentro de un `conNegocio(A)` lanza error.** Dentro de `comoSistema`, en cambio, se puede entrar a cualquier negocio: es lo que hace un worker.
- **Los temporizadores** (`setTimeout` y `setInterval` de los workers) heredan el contexto de quien los creó. Por eso cada punto de entrada de fondo empieza con su propio `comoSistema(…)`, que reemplaza lo heredado.
- **Better Auth** usa un Drizzle aparte sobre el cliente sin envoltorio (`dbDeCuentas()`). Solo ve sus 4 tablas sin RLS; si llegara a tocar `member` u `organization`, no vería nada.

**D4 Dónde se fija el negocio (puntos de entrada)**
- **`withAuth`:** después de `requireSession`, el manejador corre en `conNegocio(session.organizationId)`.
- **`requireSession`:** `getSession` usa la base de cuentas y `resolveMembership` usa la función `vocero_membresia(user_id)` de D5.
- **Rutas del cerebro:** `requireBot` pasa a `rutaDelCerebro(async (req, { organizationId }) => …)`, que hace la autenticación y corre la ruta en `conNegocio`. Son las 16 rutas: un cambio mecánico, con guardarraíl.
  - **Auth del cerebro:** `organizacionExiste` y `hastaDosOrganizaciones` pasan a funciones de D5.
- **Páginas y layouts del servidor** (8) y `/api/events`: un `conSesion(async (session) => …)` con la misma regla.
- **Webhooks:**
  - **antes de verificar,** el negocio sale de `vocero_negocio_por_canal(tipo, clave)` (solo el id);
  - **la verificación y el guardado,** `appSecretDe` y `recibirEvento`, corren en `conNegocio(org)`.
- **Workers:**
  - **descubrimiento:** cada pasada corre en `comoSistema` y descubre su trabajo con D5;
  - **procesamiento:** cada fila se procesa en `conNegocio(fila.organizationId)`;
  - **el reparto justo del bloque G** pasa a la función de descubrimiento del despacho.
- **Retención y tareas del arranque:** recorren `vocero_organizaciones()` y trabajan cada negocio dentro de `conNegocio`.
- **Laboratorio:** `startRun` envuelve su trabajo de fondo en `conNegocio(org)` de forma explícita, sin depender de lo heredado.
- **Marca sin sesión** (login, favicon, manifiesto): la marca por defecto de Aliantis, sin consultar la base (pregunta 5). Con sesión, la del negocio, como hoy.
- **`/api/health`:** los conteos globales salen de `vocero_conteo_webhooks()`, que solo devuelve números.
- **CLI:** usan la misma fábrica de cliente y corren en `conNegocio(--organizacion)`.
  - **`negocio:alta`:** fija el contexto en el id **nuevo** antes de insertar, así que el `WITH CHECK` se cumple. Los slugs ocupados salen de `vocero_slugs_ocupados(base)`.
- **Mocks de desarrollo:** siguen la misma regla. `wa-mock/status` encuentra el negocio de un mensaje recorriendo `vocero_organizaciones()`; es solo de desarrollo.

**D5 Funciones `SECURITY DEFINER` (solo ids o conteos)**

Las crea `0033` y son del rol de migraciones. Cada una lleva `SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC` y `GRANT EXECUTE … TO vocero_app`. Ninguna devuelve contenido: solo ids, el rol de una membresía o números.

| Función | Devuelve | La usa |
| --- | --- | --- |
| `vocero_membresia(user_id)` | `(organization_id, role)`, la primera por `created_at, id` | `resolveMembership` |
| `vocero_organizacion_existe(id)` | `boolean` | `requireBot` |
| `vocero_hasta_dos_organizaciones()` | `text[]` (como mucho 2 ids) | `requireBot` (la regla de compatibilidad) |
| `vocero_organizaciones()` | ids | retención, arranque, mocks |
| `vocero_negocio_por_canal(tipo, clave)` | id o `NULL`; `tipo` es uno de `phone_number_id`, `waba_id`, `ig_user_id`, `page_id`, `zernio_account` | webhooks |
| `vocero_despachos_vencidos(ahora, limite, excluir text[])` | `(id, organization_id)` | worker del despacho |
| `vocero_proximo_despacho()` | `timestamp` | la cita del worker |
| `vocero_eventos_pendientes(ahora, limite)` | `(id, organization_id)` | barrido de webhooks |
| `vocero_negocios_con_eventos_viejos(ahora)` | ids | purga de webhooks (se borra dentro de cada negocio) |
| `vocero_conteo_webhooks()` | `(pendientes, agotados)` | `/api/health` |
| `vocero_olvidos_pendientes(ahora, limite)` | `(id, organization_id)` | olvidos |
| `vocero_avisos_pendientes(ahora, limite)` | `(id, organization_id)` | avisos por Telegram |
| `vocero_slugs_ocupados(base)` | `text[]` | `crearNegocio` |

Todas las escrituras ocurren dentro de `conNegocio`; ninguna función escribe. La lista exacta se ajusta al programar si un worker necesita otra; cada función nueva cumple las mismas reglas y pasa por los mismos guardarraíles.

**D6 Despliegue**
- **`DATABASE_MIGRATIONS_URL` (dueño)** la usa `migrate.mjs`, y **`DATABASE_URL` (usuario de la app)** la usa el servidor.
- **`migrate.mjs`, después de migrar, asegura el usuario de la app** (pregunta 3). Si el usuario de `DATABASE_URL` no existe, lo crea con `LOGIN NOSUPERUSER NOBYPASSRLS`, la contraseña que trae esa misma URL (del entorno del servidor, nunca del repo) y miembro de `vocero_app`. Si ya existe, le quita `BYPASSRLS` y lo mete en `vocero_app`. No imprime la contraseña ni la URL.
- **Sin `DATABASE_MIGRATIONS_URL`** (desarrollo viejo), todo usa `DATABASE_URL` como hoy. En producción el chequeo de D2 no deja arrancar si ese usuario se salta el RLS.
- **`docker-compose.yml`, `.env.example` y la guía de despliegue** pasan a dos URLs. En Coolify, Andres agrega `DATABASE_MIGRATIONS_URL` (la de `postgres`) y cambia `DATABASE_URL` a un usuario nuevo (por ejemplo `vocero`) con su propia contraseña.

## Guardarraíles (que nadie se salte `conNegocio`)

1. **En la base:** sin `set_config`, el RLS no deja ver ni escribir nada. Es la última red.
2. **En el cliente:** sin contexto, `ConsultaSinNegocio` (D3).
3. **Prueba estática `rls-guardarrailes.test.ts`:**
   - toda tabla de `schema.ts` con `organizationId` tiene `ENABLE ROW LEVEL SECURITY` y su política en `drizzle/`. Una tabla nueva sin política rompe el CI;
   - `drizzle(` y `postgres(` solo aparecen en `src/lib/db/` y en la fábrica que usan los scripts. Los arneses E2E quedan fuera, porque son el oráculo de las pruebas y se conectan como dueño;
   - `dbDeCuentas()` solo la importa `src/lib/auth/index.ts`;
   - las 16 rutas de `/api/bot/*` usan `rutaDelCerebro`, y toda ruta de `/api` con `getDb` o `@/server` pasa por `withAuth`, `rutaDelCerebro`, `conSesion`, `conNegocio` o `comoSistema` (lista de excepciones con su porqué);
   - ninguna función de `0033` tiene `SECURITY DEFINER` sin `SET search_path`.
4. **Al arrancar:** el chequeo de D2.
5. **Contra Postgres real:** la sección siguiente.

## Verificación contra Postgres real

Las unitarias de Vocero simulan la base, así que no prueban RLS. Se agregan dos cosas:

**A. Un job nuevo en `ci.yml`, «RLS contra Postgres»** (cada push, sin etiqueta; Postgres 16 como servicio, sin Next, alrededor de 1 minuto): `scripts/e2e-rls.mjs`.
- Migra como dueño y crea el usuario de la app con `migrate.mjs`, como en producción.
- Siembra dos negocios, A y B, como dueño, con al menos una fila en **cada una de las 38 tablas con RLS**.
- **Catálogo:**
  - las 37 tablas con `organization_id` más `organization` tienen `relrowsecurity` y una política con `USING` y `WITH CHECK`;
  - el usuario de la app no es superusuario, no tiene `BYPASSRLS` y no es dueño de nada;
  - toda función `SECURITY DEFINER` tiene `search_path` fijo, no se ejecuta como `PUBLIC` y devuelve solo columnas de ids o conteos.
- **Por cada tabla, como usuario de la app:**
  - con A fijado: `SELECT` ve solo filas de A;
  - `INSERT` con `organization_id = B` falla;
  - `UPDATE` y `DELETE` sobre filas de B afectan 0 filas;
  - `UPDATE` que mueve una fila de A a B falla (`WITH CHECK`);
  - sin negocio fijado: `SELECT` ve 0 filas e `INSERT` falla.
- **Sin fuga por el pool:** en la misma conexión, una transacción con A y después una consulta sin contexto ve 0 filas (`is_local`). Con `set_config(…, false)` esto fallaría.
- **El envoltorio real** (`src/lib/db`, compilado con esbuild) contra la base: `conNegocio(A)` no ve a B, una consulta sin contexto lanza `ConsultaSinNegocio`, y `conNegocio(B)` dentro de `conNegocio(A)` lanza error.
- **Las funciones de D5** devuelven lo esperado con los dos negocios.

**B. `e2e.yml` con el usuario restringido:** Vocero se levanta con `DATABASE_URL` del usuario de la app y `DATABASE_MIGRATIONS_URL` de `postgres`.
- **Lo que pasa a correr bajo RLS:** los 6 arneses de hoy (despacho, consentimiento, contrato, retención, multinegocio y alta), es decir, todo el camino real (webhooks, workers, cerebro falso, CLI).
- **Lo que no cambia:** los arneses siguen leyendo la base como dueño para sus comprobaciones.
- **La migración sobre datos** pasa a probar también `0032`→`0033` con filas de dos negocios.

## Riesgo de cada paso

| Paso | Riesgo | Por qué |
| --- | --- | --- |
| T2 Migración `0033` | Alto | Roles, permisos y políticas en 38 tablas. Si una política está mal, la app no ve sus propios datos o ve los de otro |
| T3 Cliente con `conNegocio` | Alto | Lo usa toda consulta de la app. Además, una transacción por consulta suelta cuesta un poco más (se mide en el E2E) |
| T4 a T7 Puntos de entrada | Alto | Un punto olvidado lanza `ConsultaSinNegocio`: el error se ve (no se filtra nada), pero rompe esa función |
| T8 Postgres real | Medio | Arnés y CI nuevos |

## Archivos

- **Nuevos:**
  - `drizzle/0033_rls.sql`, escrita a mano con `drizzle-kit generate --custom`, sin cambios en `schema.ts`;
  - `src/lib/db/contexto.ts` (`conNegocio`, `comoSistema`, `ConsultaSinNegocio`) y `src/lib/db/cliente-rls.ts` (el envoltorio);
  - `src/lib/db/rls-arranque.ts` (`rlsBypassReasons`, tablas sin RLS, decisión de arranque);
  - `src/server/db-sistema.ts` (las llamadas tipadas a las funciones de D5);
  - `scripts/e2e-rls.mjs` y `tests/e2e/us-rls.md`;
  - pruebas `cliente-rls.test.ts`, `rls-arranque.test.ts` y `rls-guardarrailes.test.ts`.
- **Base y arranque:** `src/lib/db/index.ts` (`getDb` con envoltorio, `dbDeCuentas`), `src/lib/env.ts` (`DATABASE_MIGRATIONS_URL`), `scripts/migrate.mjs` (dueño y usuario de la app), `src/instrumentation-node.ts` (chequeo y tareas del arranque).
- **Sesión y auth:** `src/lib/api.ts` (`withAuth`), `src/lib/auth/index.ts`, `src/lib/auth/session.ts` (`conSesion`), `src/server/auth/on-signup.ts`, `src/server/auth/alta.ts`.
- **Cerebro:** `src/server/bot/auth.ts` (`rutaDelCerebro`), `src/server/bot/organizaciones.ts` y las 16 rutas de `src/app/api/bot/`.
- **Páginas:** `src/app/(app)/layout.tsx`, `src/app/page.tsx`, `src/app/(app)/{inbox,bookings,onboarding,results,settings/appearance,settings/branding}/page.tsx`, `src/app/api/events/route.ts`.
- **Marca:** `src/server/branding.ts`, `src/server/apariencia.ts`, `src/app/(auth)/layout.tsx`, `src/app/manifest.ts`, `src/app/layout.tsx`, `src/app/api/branding/favicon/route.ts`.
- **Webhooks:** `src/server/webhooks/{organizacion,recibir,eventos,worker}.ts`, `src/server/whatsapp/credentials.ts`, `src/server/instagram/credentials.ts`, `src/server/messenger/credentials.ts`, `src/server/zernio/{conexiones,secreto-guardado,dispatch}.ts`, las rutas `webhooks/{wa,ig,messenger,tiktok}` y `src/server/health.ts`.
- **Workers:** `src/server/dispatch/{outbox,worker,olvidos}.ts`, `src/server/avisos/avisos.ts`, `src/server/retencion/aplicar.ts`, `src/server/lab/runner.ts`.
- **CLI:** `scripts/{negocio-alta,meta-secreto,privacidad-sembrar,avisos-grupo}.ts`, `scripts/seed/demo.ts`.
- **Mocks:** `src/app/api/dev/{wa-mock/status,wa-mock/inbound,wa-mock/echo,retencion}/route.ts`.
- **CI y E2E:** `.github/workflows/{ci,e2e}.yml`, `scripts/e2e-operador.mjs` (los CLI que lanza, con el usuario de la app).
- **Docs:** `AGENTS.md`, `.env.example`, `docker-compose.yml`, `README.md` (despliegue). En `aliantis-core`: `decisiones.md` y `estado.md`.
- **Pruebas unitarias existentes:** las que simulan `@/lib/db` con `getDb: () => …` siguen igual, porque el envoltorio vive debajo de `getDb`. Las que llaman `withAuth` o rutas del cerebro se ajustan si dependen de su forma.

## Casos borde

1. Una consulta sin negocio en una ruta olvidada: `ConsultaSinNegocio`, un 500 visible en el registro y nada filtrado. El E2E lo encuentra.
2. Dos peticiones de A y B a la vez en el mismo pool: cada consulta lleva su `set_config` local, así que ninguna ve el negocio de la otra.
3. Una consulta de A que falla a mitad de su transacción: el `rollback` también borra el `set_config`.
4. Un temporizador creado dentro de `conNegocio(A)` que dispara el worker: el worker entra en `comoSistema` y procesa cada fila con su propio negocio.
5. `conNegocio(B)` dentro de `conNegocio(A)`: error. Dentro de `comoSistema`: permitido.
6. Un `INSERT … ON CONFLICT DO UPDATE` que choca con una fila de otro negocio (por ejemplo, el mismo `phone_number_id` conectado en dos negocios): Postgres da error de política. La ruta responde 409 «ya conectado en otro negocio», no 500. Se revisan las restricciones `UNIQUE` globales: `message.wa_message_id`, `meta_credentials.phone_number_id`, `organization.slug`, `user.email`.
7. Un `wa_message_id` repetido entre negocios: Meta los hace únicos en el mundo; si chocara, ganaría el primero, como hoy.
8. Un webhook de un número que no está en ningún negocio: `vocero_negocio_por_canal` devuelve `NULL` y se descarta, como hoy.
9. El login sin sesión: marca por defecto; nunca la de un cliente.
10. Un dueño que inicia sesión: `getSession` corre en modo cuentas y `vocero_membresia` le da su negocio; de ahí en adelante, todo en `conNegocio`.
11. El arranque en producción con `DATABASE_URL=postgres…` (superusuario): no arranca, con el motivo y el arreglo.
12. Una tabla nueva con `organization_id` sin política: la prueba estática rompe el CI; si llegara a producción, el chequeo del arranque no deja arrancar.
13. La migración `0033` sobre una base con datos de dos negocios: no cambia filas. Se puede correr dos veces (`IF NOT EXISTS`, `DROP POLICY IF EXISTS` antes de `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`).
14. El rol `vocero_app` ya existe (segunda corrida, o el mismo Postgres con otra base): la migración no falla.
15. El cerebro en el mismo Postgres: `vocero_app` no tiene permisos sobre el esquema `cerebro`, ni `cerebro_app` sobre `public`.
16. Una consulta suelta cuesta `begin` + `set_config` + consulta + `commit`, en *pipeline*. Se compara la duración de `e2e-despacho` con la de hoy (unos 6,5 min); si sube más de un 20 %, se para y se pregunta.

## Sabotajes (11)

| # | Sabotaje | Lo detecta |
| --- | --- | --- |
| 1 | Quitar la política de una tabla en `0033` | `rls-guardarrailes.test.ts` y el job «RLS contra Postgres» |
| 2 | Política solo con `USING`, sin `WITH CHECK` | `e2e-rls` (el `INSERT` cruzado pasa) |
| 3 | `set_config(…, false)` (no local) | `cliente-rls.test.ts` y `e2e-rls` (fuga por el pool) |
| 4 | El envoltorio deja pasar una consulta sin contexto | `cliente-rls.test.ts` y `e2e-rls` |
| 5 | El usuario de la app con `BYPASSRLS` | `rls-arranque.test.ts` y `e2e-rls` (catálogo) |
| 6 | Una función de D5 que devuelve filas completas (`select *` de credenciales) | `e2e-rls` (columnas permitidas) |
| 7 | Una función `SECURITY DEFINER` sin `search_path` | `rls-guardarrailes.test.ts` y `e2e-rls` |
| 8 | `conNegocio(B)` dentro de `conNegocio(A)` permitido | `cliente-rls.test.ts` y `e2e-rls` |
| 9 | `withAuth` que no envuelve en `conNegocio` | `cliente-rls.test.ts` (y el E2E entero cae) |
| 10 | El worker procesa una fila en el negocio equivocado (el de la primera fila) | prueba unitaria del worker |
| 11 | Una tabla nueva con `organization_id` sin política | `rls-guardarrailes.test.ts` |

## Lo que esta spec no hace

- RLS en `user`, `session`, `account` y `verification` (D1).
- El panel de Andres y su segundo factor: bloque I. Cuando llegue, ese panel usará funciones `SECURITY DEFINER` de solo conteos, con la misma regla (D16: nunca conversaciones).
- Cambiar el cerebro.

## Respuestas de Andres (11-nov-2026)

1. **Consulta sin negocio:** lanza `ConsultaSinNegocio` siempre.
2. **Better Auth:** `user`, `session`, `account` y `verification` sin RLS (documentado); `organization`, `member` e `invitation` con RLS.
3. **Usuario de la app en producción:** lo crea `migrate.mjs` desde `DATABASE_URL`, sin imprimir nunca la contraseña ni la URL.
4. **Sin `FORCE ROW LEVEL SECURITY`:** confirmado.
5. **Marca sin sesión:** la de Aliantis por defecto.
6. **Verificación contra Postgres real:** en los dos lados (job en `ci.yml` en cada push y `e2e.yml` completo con el usuario restringido).
7. **CLI:** con el usuario de la app dentro de `conNegocio(--organizacion)`.
8. **Ajuste:** las políticas usan `NULLIF(current_setting('app.organization_id', true), '')`.
9. **Rendimiento:** si `e2e-despacho` sube más de un 20 %, se para y se pregunta.
