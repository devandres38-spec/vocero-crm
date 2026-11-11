# 076 — El panel de Andres (bloque I, paso 4.6)

**Estado:** aprobado por Andres (11-nov-2026), con las 8 respuestas como se recomendaron (sección 14).
**Concreta:** D16 de Aliantis («`/admin` dentro de Vocero, superadministrador fuera de todo negocio, TOTP obligatorio, solo agregados, prueba que falla si consulta conversaciones, el gasto del LLM lo lee del cerebro») y los dos pendientes del bloque G (cambiar contraseña y tope de cuentas de equipo).
**Repos:** `vocero-crm` (casi todo), `aliantis-brain` (el puente del gasto, spec `012-gasto-para-el-panel`) y `aliantis-core` (`decisiones.md` y `estado.md`).
**Revisado contra:** `vocero-crm` `bb4f1fa` (bloque H unido), `aliantis-brain` `98149d1` y Better Auth 1.6.23 instalado (`node_modules`, no la documentación).

---

## 1. Lo que hay hoy (auditoría)

| Tema | Código real | Consecuencia para el bloque |
| --- | --- | --- |
| Better Auth | `src/lib/auth/index.ts`: solo el plugin `organization` (rutas en 404 desde el bloque G). `package.json` pide `^1.1.14`; instalado **1.6.23**. | El plugin `twoFactor` de 1.6.23 trae TOTP con el secreto **cifrado** (XChaCha20 con `BETTER_AUTH_SECRET`), códigos de respaldo cifrados, bloqueo de la cuenta tras **10 fallos durante 15 min** y un límite de 3 intentos cada 10 s en `/two-factor/*`. No hay que escribir criptografía propia. |
| Flujo de login con 2FA | El plugin borra la sesión del `sign-in/email` si `user.twoFactorEnabled` y responde `twoFactorRedirect: true`; la sesión nace solo tras `/two-factor/verify-totp` o `verify-backup-code`. | La pantalla de login necesita un segundo paso (código de 6 dígitos o código de respaldo). Los usuarios de negocio no tienen 2FA: su login no cambia. |
| Rutas peligrosas del plugin | `/two-factor/enable`, `/disable`, `/get-totp-uri`, `/generate-backup-codes`, `/send-otp`, `/verify-otp`. | Hay que cerrarlas con `bloqueoDeRuta` (como `/organization/*`), salvo `enable` en el alta del segundo factor (ver 3.2). |
| Sesión del negocio | `requireSession()` → `resolveMembership()` → `vocero_membresia` (función de solo ids). Sin membresía lanza `UnauthorizedError`. | Un superadmin sin membresía hoy rebota: `/` → `/inbox` → layout → `/login`. Hay que desviarlo a `/admin` en la raíz y en el login. |
| Usuarios | `user` sin columna de rol; `member.role` es `owner` / `admin` / `member`. Sin RLS en `user`, `session`, `account`, `verification`. | El superadmin no puede ser un rol de `member` (eso es «dentro de un negocio»). Va en una tabla aparte (3.1). |
| Alta de negocios | `crearNegocio(db, datos)` en `src/server/auth/alta.ts`: una transacción, `conNegocio(nuevoId)`, contraseña de 24 caracteres devuelta una vez. Lo usa `pnpm negocio:alta`. | El panel la reutiliza tal cual. |
| Comandos en producción | La imagen trae solo `migrate.mjs` y `seed-demo.mjs` empaquetados con esbuild. `negocio:alta` no está en la imagen. | El comando del superadmin se empaqueta igual (`superadmin.mjs`) para poder correrlo con `docker exec`. |
| Equipo | `/api/settings/team`: `GET` y `POST` (solo `owner`, contraseña temporal de mínimo 8 tecleada por el dueño). No hay borrar, ni cambiar rol, ni tope. | La cuenta de equipo nace con una contraseña que conoce el dueño: justo el caso del «cambiar contraseña». |
| Cambiar contraseña | No hay pantalla. Better Auth trae `/change-password` (contraseña actual + nueva + `revokeOtherSessions`) y no está bloqueada. `scripts/reset-password.mjs` imprime un `UPDATE` a mano. | La pantalla usa la ruta de Better Auth; no hay que escribir el cambio. |
| «Pausar» | No existe a nivel negocio. Existe `agent_profile.enabled` (el interruptor del dueño) y, con él apagado, `despacharAlCerebro` sigue despachando lo marcado con salud (D9). | «Pausar» es nuevo: una columna en `organization` y sus efectos (pregunta 2). |
| Salud técnica | `/api/health` cuenta webhooks pendientes y agotados (`conteoGlobal`, función de solo conteos). `getBrainHealth()` lee el `/health` del cerebro con caché de 15 s. | El tablero reutiliza las dos. |
| Postgres | 16 en `docker-compose.yml`, CI y el cerebro. | Permite `GRANT … WITH INHERIT FALSE` (PG 16+), la base del candado (3.3). |
| Gasto del LLM | En el cerebro: `cerebro.llm_calls` (costo en USD por llamada, `es_prueba`, `outcome`, sin texto) con RLS por negocio; el tope es `llm.tope_diario_usd` y la zona `tenant.zona_horaria` en `cerebro.tenant_configs` (la versión más alta por negocio). El cerebro solo expone `/health` y `POST /vocero/dispatch` (firma HMAC-SHA256 del cuerpo con `BOT_API_KEY`). Ya usa funciones `SECURITY DEFINER` de solo ids (0002, 0004 y 0006). | Hace falta una función de solo agregados y una ruta firmada nueva en el cerebro (sección 6). |
| Interfaz | `src/components/ui`: `button`, `card`, `input`, `label`, `badge`, `switch`, `textarea`, `empty-state`; temas con `ThemeToggle`; `AppShell` y `app-nav` están atados a la Bandeja (eventos, avisos, borradores). No hay librería de QR. | `/admin` lleva un *shell* propio, más simple, con las mismas piezas y los mismos tokens de color. |

---

## 2. Qué se construye (resumen)

1. Un **superadministrador fuera de todo negocio**, creado por un comando que exige la URL del dueño de la base.
2. **TOTP obligatorio:** sin segundo factor activado, `/admin` solo muestra la pantalla para activarlo; el login pide el código.
3. **El candado D16 en tres capas:**
   - la base: un rol `vocero_panel` sin permisos sobre ninguna tabla;
   - el código: un guardarraíl estático;
   - una prueba contra Postgres real.
4. **`/admin`:**
   - un **resumen** de salud y gasto;
   - la **tabla de negocios** con conteos;
   - el **detalle** de cada negocio, con sus usuarios;
   - **alta, pausar y activar**;
   - el **registro** de lo que hizo Andres.
5. **El puente del gasto** con el cerebro: una ruta firmada que devuelve solo sumas por negocio.
6. **«Mi cuenta»** para todos los usuarios de un negocio: cambiar la contraseña, obligatorio en el primer ingreso cuando la puso otra persona.
7. **Tope de cuentas de equipo:** recomiendo **no** ponerlo todavía (sección 8).

---

## 3. Superadministrador y TOTP

### 3.1 Quién es superadmin

- **Tabla nueva `superadministrador`** (`user_id` PK → `user.id`, `creado_en`, `totp_activado_en`). Sin `organization_id` y sin RLS, como `user`.
- **Permisos:** el usuario de la app (`vocero_app`) solo puede hacer `SELECT` sobre ella. Nadie la escribe desde la app, ni siquiera con un error de código: dar o quitar el superadmin exige la conexión del dueño de las tablas (`DATABASE_MIGRATIONS_URL`).
- **Un superadmin nunca es miembro de un negocio:**
  - un *trigger* en `member` (`BEFORE INSERT OR UPDATE`) rechaza un `user_id` que esté en `superadministrador`;
  - el comando rechaza un correo que ya exista (un correo es de una sola cuenta, regla del bloque G).

### 3.2 Cómo nace (comando) y cómo activa el segundo factor (web)

**El comando** `pnpm superadmin:alta -- --correo <c> --nombre "<n>"` corre en local o, empaquetado en la imagen, con `docker exec <contenedor> node superadmin.mjs …`. Hace lo siguiente:

1. Exige `DATABASE_MIGRATIONS_URL`. Sin ella, se niega y dice por qué.
2. En una transacción, con el dueño, crea `user` y `account` (el mismo `hashPassword` de `crearNegocio`) y la fila en `superadministrador`.
3. Imprime **una sola vez** la contraseña generada (24 caracteres), sin dejarla en ningún registro.

`--reiniciar-segundo-factor --correo <c>` borra su TOTP y sus sesiones, para cuando Andres pierda el teléfono **y** los códigos de respaldo. También exige la URL del dueño.

**Primer ingreso (recomendado; pregunta 1):**

1. Andres entra con correo y contraseña. Como aún no tiene segundo factor, el *guard* de `/admin` lo lleva a `/admin/segundo-factor` y no deja ver nada más.
2. Ahí confirma su contraseña. La ruta llama a `/two-factor/enable` de Better Auth y muestra **un código QR** (generado en el servidor como SVG con `uqr`, una dependencia pequeña y sin dependencias propias) más el secreto en texto. Muestra también los **10 códigos de respaldo** una sola vez.
3. Andres escribe un código de su app (Google Authenticator, 1Password…). `/two-factor/verify-totp` lo activa.
4. Vocero cierra **todas** sus sesiones y lo manda al login. Desde ahí, siempre contraseña más código.

`/two-factor/enable` solo se abre para quien está en `superadministrador` y aún no tiene el segundo factor. Para los demás, y para él ya activado, queda en 404. `disable`, `get-totp-uri`, `generate-backup-codes`, `send-otp` y `verify-otp` quedan en 404 siempre: el segundo factor solo se reinicia con el comando.

### 3.3 El *guard* de `/admin` (`requireSuperadmin`)

Cada página y cada ruta de `/admin` y de `/api/admin` pasa por él, en este orden:

1. **Sesión de Better Auth válida;** si no, a `/login`.
2. **Su `user_id` está en `superadministrador`;** si no, 404 (no se revela que el panel existe).
3. **`user.twoFactorEnabled`;** si no, solo `/admin/segundo-factor`.
4. **La sesión nació después de `totp_activado_en`** (una sesión de antes de activar el factor no sirve).
5. **La sesión tiene menos de 12 h** (pregunta 6); si no, se cierra y vuelve al login.

Con eso devuelve `{ userId }` y corre lo demás dentro de `comoPanel()` (3.4).

**Desvíos:** en la raíz `/` y en el login, un superadmin va a `/admin`. Un superadmin que pide `/inbox`, `/settings`, `/api/contacts`… sigue recibiendo lo de hoy (sin membresía: login o 401). Nunca entra a un negocio.

**Login:** el formulario gana un segundo paso. Si la respuesta trae `twoFactorRedirect`, pide «Código de tu app» (6 dígitos), con un enlace «Usar un código de respaldo». Sin «confiar en este dispositivo» (pregunta 6).

### 3.4 El candado D16 en la base: rol `vocero_panel`

- **El rol:** la migración crea `vocero_panel` (`NOLOGIN`, `NOBYPASSRLS`) **sin ningún permiso sobre tablas** y con `EXECUTE` solo sobre las funciones `vocero_panel_*`.
- **Cómo se entra a él:** `GRANT vocero_panel TO vocero_app WITH INHERIT FALSE, SET TRUE`. El usuario de la app puede entrar al rol con `SET LOCAL ROLE`, pero **no hereda** sus permisos: el código de un negocio no puede llamar a las funciones del panel.
- **`comoPanel(fn)`** es un contexto nuevo en `contexto.ts`. En ese contexto, `cliente-rls.ts` abre cada consulta en una transacción con `SET LOCAL ROLE vocero_panel` antes de la consulta (igual que hoy `set_config` en `conNegocio`). Dentro de `comoPanel`:
  - un `select` a `message`, `contact`, `conversation_note`… da **permiso denegado en Postgres**, no un resultado vacío;
  - `conNegocio` y `comoSistema` lanzan `PanelSinSalida`: no se puede saltar del panel a un negocio.
- **Lo que sí ve el panel:** solo las funciones `vocero_panel_*` (`SECURITY DEFINER`, `search_path` fijo, `REVOKE` de `PUBLIC`). Devuelven **solo ids, nombres del negocio y de su personal, conteos, sumas, banderas y fechas**; nunca una columna de texto de un paciente o de una conversación.
- **La única puerta de escritura fuera del rol del panel es `crearNegocio()`:** corre en `conNegocio(nuevoId)` con el usuario de la app, como hoy desde el comando. Escribe; no lee nada de pacientes.
- **Al arrancar:** `checkRls()` comprueba que `vocero_app` no herede `vocero_panel` (`pg_auth_members.inherit_option = false`). Si lo hereda, en producción la app no arranca.

### 3.5 Las funciones `vocero_panel_*`

| Función | Devuelve |
| --- | --- |
| `vocero_panel_negocios()` | Por negocio: `id`, `nombre`, `slug`, `creado_en`, `pausado_en`, `agente_encendido`, canales conectados (4 booleanos), `usuarios`, `conversaciones`, `conversaciones_7d`, `entrantes_24h`, `ultimo_entrante_en`, `despachos_pendientes`, `a_humano_24h`, `webhooks_pendientes`, `webhooks_agotados`, `retencion_dias`. |
| `vocero_panel_salud()` | Totales de la instalación: webhooks pendientes y agotados, despachos pendientes, en vuelo y vencidos, olvidos pendientes, avisos sin enviar y la fecha del último entrante. |
| `vocero_panel_usuarios(org)` | `user_id`, `nombre`, `correo`, `rol`, `creado_en`, `ultima_sesion_en`, `debe_cambiar_contrasena`. Es personal del negocio, no pacientes. |
| `vocero_panel_pausar(org, pausar bool)` | `pausado_en`. Cierra las sesiones de su personal al pausar. Anota en el registro. |
| `vocero_panel_restablecer(org, user, hash)` | Nada. Exige que el usuario sea de ese negocio, cambia el hash, marca `debe_cambiar_contrasena`, cierra sus sesiones y anota en el registro. |
| `vocero_panel_quitar_usuario(org, user)` | Nada. No permite quitar al último `owner`. Borra la membresía y la cuenta (un correo es de un solo negocio) y anota en el registro. |
| `vocero_panel_anotar(accion, org, detalle)` | Nada. Para lo que no pasa por una función, como el alta. |
| `vocero_panel_registro(limite)` | Las últimas acciones: `cuando`, `accion`, `organization_id`, `nombre_negocio`, `detalle`. |

**Registro (`registro_panel`):**
- Columnas: `id`, `cuando`, `superadmin_id`, `accion`, `organization_id`, `detalle`. `detalle` es un JSON corto, sin contraseñas, hashes ni correos de pacientes; lleva, por ejemplo, el correo del dueño en un alta o el del usuario restablecido.
- Sin RLS y sin permisos para la app: solo se escribe por las funciones y solo se lee por `vocero_panel_registro`.
- Es solo de adición: nadie tiene `UPDATE` ni `DELETE`.

**Quién llama:** el `superadmin_id` llega a las funciones por `set_config('app.superadmin_id', …, true)`, que `comoPanel` fija junto con el `SET LOCAL ROLE`. La función lo exige y comprueba que esté en `superadministrador`, así que una llamada sin superadmin válido falla.

---

## 4. `/admin`: estructura y diseño

### 4.1 Navegación propia

- **Grupo de rutas `src/app/(admin)/admin/…`,** con su propio *layout* y un `PanelShell` nuevo. No usa `AppShell` ni `app-nav`: sin Bandeja, Contactos, Pipeline, Citas, eventos en vivo ni avisos de mensajes.
- **Escritorio:** barra lateral angosta con la marca («Aliantis · Panel», con la marca por defecto, la de Vocero, hasta que Andres dé la de Aliantis) y estas entradas:
  - **Resumen**
  - **Negocios**
  - **Registro**
  - abajo, **Tema**, **Mi cuenta** y **Salir**.
- **Celular:** barra superior con la marca y, abajo, una barra de pestañas fija con **Resumen**, **Negocios**, **Registro** y **Más**. Botones de al menos 44 px. Las tablas pasan a tarjetas apiladas.
- **Estilo:** las mismas piezas (`Card`, `Button`, `Badge`, `Input`), los mismos tokens claro y oscuro, la tipografía y el radio de Vocero, e íconos de `lucide-react` (ya está).

### 4.2 Pantallas

**`/admin` (Resumen)**
- **Servicios:**
  - Vocero (la base responde, versión y commit);
  - cerebro (`/health`, versión y commit);
  - webhooks pendientes y agotados;
  - despachos pendientes, en vuelo y vencidos;
  - olvidos y avisos pendientes.

  Cada uno con un punto verde, ámbar o rojo, sin texto de mensajes. Los umbrales del semáforo son simples:
  - agotados > 0: rojo;
  - vencidos > 0: ámbar.
- **Gasto del LLM:**
  - hoy (suma de todos) y mes;
  - por negocio, una barra de gasto de hoy frente a su tope, ordenada por porcentaje (≥ 80 % en ámbar, ≥ 100 % en rojo);
  - lo del Laboratorio aparte.

  Si el cerebro no responde: «No se pudo leer el gasto» y el resto de la página sigue.
- **Atención:**
  - negocios pausados;
  - negocios sin canal conectado;
  - negocios con el agente encendido y sin entrantes en 7 días.

**`/admin/negocios`**
- **Columnas de la tabla:** nombre; estado (Activo / Pausado); agente; canales (íconos); usuarios; conversaciones; entrantes 24 h; gasto de hoy frente al tope; alta.
- **Búsqueda** por nombre.
- **Botón «Nuevo negocio».**

**`/admin/negocios/nuevo`**
- **Formulario:** nombre del negocio, nombre del dueño y correo, con la misma validación `datosAlta`.
- **Al crear:** una pantalla que muestra **una sola vez**:
  - la contraseña, con un botón «Copiar» y el aviso «No se vuelve a mostrar»;
  - el id del negocio, que piden `cliente:sembrar` del cerebro, `meta:secreto` y `privacidad:sembrar`.
- **Al recargar la página,** la contraseña ya no está. Va en la respuesta del `POST`, nunca en una URL ni en el registro.

**`/admin/negocios/[id]`**
- **Arriba:** los conteos de ese negocio y su gasto de hoy y del mes frente al tope.
- **Usuarios:** nombre, correo, rol, alta, última sesión y «debe cambiar contraseña». Acciones:
  - **Restablecer contraseña:** genera una nueva, la muestra una vez y obliga a cambiarla en el siguiente ingreso;
  - **Quitar cuenta:** no se ofrece para el último dueño.
- **Pausar o activar:** confirmación escribiendo el nombre del negocio.

**`/admin/registro`:** las últimas 200 acciones.

**`/admin/segundo-factor`:** la activación de 3.2.

**API:** `src/app/api/admin/*` (`negocios` GET/POST, `negocios/[id]` GET, `negocios/[id]/pausa` POST, `negocios/[id]/usuarios/[userId]/contrasena` POST, `…/usuarios/[userId]` DELETE, `registro` GET, `gasto` GET, `segundo-factor` POST), todas con `rutaDelPanel()` (= `requireSuperadmin` + `comoPanel`). Las mutaciones exigen `POST` o `DELETE` con `Content-Type: application/json` y el mismo origen, como las rutas de hoy.

### 4.3 Qué significa «Pausado» (recomendación; pregunta 2)

- **El personal del negocio no entra:**
  - al pausar se cierran sus sesiones;
  - `vocero_membresia` devuelve también `pausado`, y `requireSession` lanza `NegocioPausado`;
  - el login dice «Este negocio está pausado. Escríbele a Aliantis».
- **El bot queda como con el agente apagado:** `despacharAlCerebro` no despacha lo normal, pero **sí lo marcado con salud** (D9: la seguridad del paciente no se pausa). La frase de salud sale de las reglas del cerebro, antes del LLM, así que no gasta.
- **Lo que sigue corriendo:**
  - la ingesta de webhooks, para que no se pierdan mensajes al reactivar;
  - la **retención**, los **olvidos** y el borrado de «No acepto», que son obligaciones de la Ley 1581 y no se detienen.
- **Activar** quita la marca, y el personal vuelve a entrar con su contraseña de siempre.

---

## 5. Candado de privacidad (D16): guardarraíl y pruebas

Tres capas; las dos primeras van en el CI de cada PR:

1. **Estático (`tests/unit/panel-candado.test.ts`).** Recorre `src/app/(admin)/**`, `src/app/api/admin/**`, `src/server/panel/**` y `src/components/panel/**` (más lo que importen dentro de `src/`, en profundidad) y falla si:
   - importan `@/lib/db`, `@/lib/db/schema` o `drizzle-orm`, salvo el único módulo de datos `src/server/panel/datos.ts`, que solo llama a `vocero_panel_*` por SQL;
   - importan cualquier módulo de `src/server/{inbox,contacts,conversations,ficha,notes,lab,privacy,webhooks,dispatch}/**` o de `src/app/api/{conversations,contacts,…}`;
   - aparece el nombre de una tabla de pacientes o conversaciones (`message`, `conversation`, `conversation_note`, `contact`, `lead`, `booking`, `consent`, `webhook_event`, `media_asset`, `agent_test_run`, `agent_test_case`, `ad_attribution`, `olvido_pendiente`…) en el SQL de `datos.ts`;
   - usan `conNegocio`, `comoSistema` o `trabajoDeFondo` (la única excepción declarada es `crearNegocio`).

   Además, sobre la migración: las funciones `vocero_panel_*` solo devuelven columnas de una lista blanca de tipos y nombres. Un `text` que no sea `id`, `nombre`, `slug`, `correo`, `rol`, `accion` o `detalle` hace fallar la prueba.
2. **Contra Postgres real (`scripts/e2e-rls.mjs`, job «RLS contra Postgres»), con un caso nuevo por cada riesgo:**
   - con `SET ROLE vocero_panel`, un `SELECT` a cada una de las 38 tablas con RLS más `user`, `account`, `session`, `verification`, `two_factor`, `registro_panel` y `superadministrador` da `permission denied`;
   - `vocero_app` sin `SET ROLE` no puede ejecutar `vocero_panel_*`;
   - las funciones sin `app.superadmin_id`, o con uno que no es superadmin, fallan;
   - `vocero_panel_negocios()` con dos negocios sembrados devuelve los dos, con números correctos y sin texto;
   - el *trigger* impide hacer miembro a un superadmin;
   - `vocero_app` no puede escribir en `superadministrador`.
3. **De punta a punta (`scripts/e2e-panel.mjs` en `e2e.yml`):**
   - crea el superadmin con el comando y entra con contraseña y TOTP (el script calcula el código con `node:crypto` desde el secreto que devuelve la activación);
   - da de alta un negocio, lo pausa (su dueño no entra), lo activa (vuelve a entrar) y restablece una contraseña;
   - comprueba que ninguna respuesta de `/api/admin/*` trae un texto de mensaje sembrado (busca una frase centinela en todos los cuerpos).

---

## 6. El puente del gasto con `aliantis-brain`

**En el cerebro (spec `012-gasto-para-el-panel`, migración `0007_gasto_panel.sql`):**
- **La función `cerebro.gasto_por_negocio(ahora timestamptz)`** (`SECURITY DEFINER`, `search_path` fijo, solo `EXECUTE` para `cerebro_app`):
  - lee para cada negocio la última versión de `tenant_configs`, su `tope_diario_usd` y su `zona_horaria`;
  - devuelve por negocio `organization_id`, `tope_diario_usd`, `zona_horaria`, `hoy_usd`, `mes_usd`, `llamadas_hoy`, `fallidas_hoy` y `pruebas_hoy_usd`;
  - el día y el mes van en la zona de cada negocio, con la misma regla de `startOfDayInZone`;
  - nunca devuelve `conversation_id` ni nada por conversación.
- **La ruta `POST /vocero/gasto`:**
  - el cuerpo es `{"en": "<ISO>"}`; la firma va en `x-vocero-signature`, con la misma forma de `firmarCuerpo`, pero con una **llave derivada**: `HMAC(BOT_API_KEY, "aliantis:panel:gasto:v1")` (pregunta 5);
  - rechaza `en` con más de 5 minutos de diferencia (no se puede repetir una petición vieja);
  - la respuesta tiene un esquema con `additionalProperties: false`.
- **Pruebas:**
  - unitarias: firma, frescura y forma;
  - contra la base del CI del cerebro: dos negocios en zonas distintas cerca de la medianoche, y que la función no ve ni devuelve nada por conversación;
  - sabotajes en CI (PRs borrador que se cierran sin merge, como en el bloque H).

**En Vocero (`src/server/panel/gasto.ts`):**
- La URL sale del origen de `BRAIN_DISPATCH_URL` + `/vocero/gasto` (sin variable nueva).
- Espera hasta 3 s, guarda en caché 60 s y valida la respuesta con zod.
- Si falla, `null` y el aviso en la pantalla.
- Solo se llama desde el panel.

---

## 7. Cambiar la contraseña («Mi cuenta»)

- **Dónde:** `/cuenta`, fuera de Configuración, para **todos** los roles de un negocio. Se entra desde el menú del usuario en `app-nav` (junto a «Salir»). El superadmin tiene la suya en `/admin/cuenta`.
- **Formulario:**
  - contraseña actual, nueva y repetir;
  - usa `/change-password` de Better Auth con `revokeOtherSessions: true`, así que se cierran las demás sesiones.
- **Contraseña mínima de 12 caracteres para toda contraseña nueva** (pregunta 3):
  - `minPasswordLength` de Better Auth pasa de 8 a 12;
  - el `POST` de equipo pide 12;
  - las contraseñas de hoy siguen sirviendo.
- **Cambio obligatorio en el primer ingreso** (pregunta 3):
  - columna `user.debe_cambiar_contrasena` (*additional field* de Better Auth, `input: false`);
  - nace en `true` para el dueño creado por `crearNegocio`, la cuenta de equipo que crea el dueño y la cuenta que Andres restablece;
  - mientras esté en `true`, el *layout* del negocio redirige a `/cuenta` con el aviso «Pon tu propia contraseña para seguir»;
  - un gancho `after` de `/change-password` la pone en `false`;
  - las APIs del negocio no se bloquean, solo las páginas: el cerebro y los webhooks no tienen sesión de usuario.

---

## 8. Tope de cuentas de equipo

**Recomendación: no ponerlo todavía.**
- Hoy solo el dueño crea cuentas y cada alta la hace Andres; no hay autoservicio que abusar.
- El número saldrá de los paquetes (A, B y C), que aún no tienen precio ni límites decididos.
- En este bloque, la tabla del panel muestra cuántos usuarios tiene cada negocio, así que Andres lo ve sin tope.
- Cuando existan los paquetes, el tope es una columna y una comprobación en `POST /api/settings/team` (se anota en `estado.md` como pendiente del bloque de paquetes).

---

## 9. Migraciones

- **Vocero `0034_panel.sql`**, escrita a mano como la `0033`, con su *snapshot* (`pnpm db:generate` para las columnas y tablas que Drizzle conoce):
  - `user.two_factor_enabled` (bool, `false`) y `user.debe_cambiar_contrasena` (bool, `false`);
  - la tabla `two_factor` de Better Auth (`id`, `secret`, `backup_codes`, `user_id` → `user` en cascada, `verified`, `failed_verification_count`, `lock_until`). La app tiene CRUD (Better Auth la usa) y no lleva RLS, como `user`;
  - `organization.pausado_en` (timestamp nulo);
  - `superadministrador` y `registro_panel` (3.1 y 3.5);
  - el rol `vocero_panel`, el `GRANT … WITH INHERIT FALSE`, las 8 funciones `vocero_panel_*` y el *trigger* de `member`;
  - `vocero_membresia` devuelve también `pausado` (`CREATE OR REPLACE` con la misma firma de entrada; cambia el `RETURNS TABLE`, así que va `DROP` + `CREATE` en la misma migración).

  Aditiva: no reescribe datos. Se prueba sobre datos de dos negocios, como la `0033`.
- **Cerebro `0007_gasto_panel.sql`:** solo la función.

---

## 10. Archivos

**Vocero, nuevos:**
- **Base:**
  - `drizzle/0034_panel.sql` (+ *meta*);
  - `src/server/panel/{guard,datos,gasto,alta}.ts`;
  - `src/server/panel/ruta.ts` (`rutaDelPanel`).
- **Páginas y rutas:**
  - `src/app/(admin)/admin/{layout,page}.tsx`, `negocios/{page,nuevo/page,[id]/page}.tsx`, `registro/page.tsx`, `segundo-factor/page.tsx`, `cuenta/page.tsx`;
  - `src/app/api/admin/**`;
  - `src/app/(app)/cuenta/page.tsx` y `src/app/api/cuenta/**` (si hace falta algo además de Better Auth).
- **Componentes:**
  - `src/components/panel/{panel-shell,panel-nav,barra-gasto,semaforo,contrasena-una-vez,qr-totp,tabla-negocios}.tsx`;
  - `src/components/cuenta/cambiar-contrasena.tsx`.
- **Comando:** `scripts/superadmin.ts` (+ entrada `superadmin:alta` en `package.json` y su *bundle* en el `Dockerfile`).
- **Pruebas y E2E:**
  - `scripts/e2e-panel.mjs` y `tests/e2e/us-panel.md`;
  - pruebas unitarias: `panel-candado`, `panel-guard`, `panel-rutas`, `panel-datos`, `panel-gasto`, `superadmin-comando`, `login-segundo-factor`, `cuenta-contrasena` y `negocio-pausado`.

**Vocero, cambia:**
- **Autenticación y sesión:**
  - `src/lib/auth/index.ts`: `twoFactor` con `issuer: "Aliantis"`, `minPasswordLength: 12`, el campo adicional y el gancho `after`;
  - `src/server/auth/registration.ts`: los cierres de `/two-factor/*`;
  - `src/lib/auth/session.ts`: `NegocioPausado`;
  - `src/lib/auth/client.ts`: `twoFactorClient`;
  - `src/server/auth/alta.ts`: `debe_cambiar_contrasena = true`.
- **Base:**
  - `src/lib/db/schema.ts`;
  - `src/lib/db/contexto.ts` (`comoPanel`, `PanelSinSalida`);
  - `src/lib/db/cliente-rls.ts` (`SET LOCAL ROLE`);
  - `src/lib/db/rls-arranque.ts` (sin herencia del panel);
  - `src/server/db-sistema.ts` (`membresiaDe` con `pausado`).
- **Páginas y equipo:**
  - `src/app/(auth)/login/page.tsx` (segundo paso);
  - `src/app/page.tsx` (desvío del superadmin);
  - `src/app/(app)/layout.tsx` (cambio obligatorio);
  - `src/components/app-nav.tsx` («Mi cuenta»);
  - `src/app/api/settings/team/route.ts` (12 caracteres y la marca).
- **Despacho:** `src/server/dispatch/encolar.ts` (pausado = agente apagado).
- **Pruebas de RLS:** `scripts/e2e-rls.mjs` y `tests/unit/rls-guardarrailes.test.ts`, con las tablas nuevas sin RLS en la lista declarada.
- **CI, despliegue y docs:**
  - `.github/workflows/e2e.yml` (paso del panel);
  - `Dockerfile` (`superadmin.mjs`);
  - `package.json` (`uqr`, `superadmin:alta`);
  - `AGENTS.md`, `README.md` y `.env.example` (sin variables nuevas; solo la explicación).

**Cerebro:**
- `drizzle/0007_gasto_panel.sql`;
- `src/routes/gasto.ts`;
- `src/cerebro.ts` (registrar la ruta);
- pruebas unitarias y de base;
- `specs/012-gasto-para-el-panel/`.

**Core:** `decisiones.md` («Panel de Andres, bloque I») y `estado.md`.

---

## 11. Casos borde

1. **Superadmin y negocio a la vez:** un dueño intenta crear una cuenta de equipo con el correo de Andres → 409, como hoy (correo único); y el *trigger* lo frena aunque alguien lo intente directo por SQL con la app.
2. **Pérdida del teléfono:**
   - con los códigos de respaldo, entra y sigue. Cada código sirve una sola vez; el panel muestra cuántos le quedan, leídos con la cuenta de Better Auth, no desde el panel;
   - sin ellos, `superadmin:alta --reiniciar-segundo-factor` con la URL del dueño.
3. **Fuerza bruta del código:** límite de 3 cada 10 s y bloqueo de 15 min tras 10 fallos (Better Auth). El login sin 2FA sigue con el límite de hoy (10 cada 10 min por IP).
4. **Sesión robada antes de activar el factor:** no sirve para `/admin` (paso 4 del *guard*), y activar el factor cierra todas.
5. **Superadmin con la pestaña abierta 2 días:** a las 12 h, el *guard* cierra la sesión.
6. **Correo del alta ya existente:** `AltaError("correo_existente")`, en un mensaje claro; no se crea nada.
7. **Doble clic en «Crear negocio»:** el candado `CANDADO_ALTA` y el correo único dejan un solo negocio; el segundo da `correo_existente`. El botón también se deshabilita.
8. **Recargar la pantalla de la contraseña:** ya no está; para otra, «Restablecer contraseña» del dueño.
9. **Pausar el negocio en medio de un turno del cerebro:** el despacho ya en vuelo termina (no se corta una respuesta a medias); lo siguiente no se despacha, salvo salud.
10. **Pausado con mensajes de salud:** se despachan y se responden (D9).
11. **Quitar al último dueño:** la función lo rechaza. Para cambiar de dueño, pendiente fuera de este bloque.
12. **Restablecer la contraseña de alguien de otro negocio** (manipulando el id): la función comprueba la membresía y falla.
13. **El cerebro caído o sin `BRAIN_DISPATCH_URL`:** el gasto dice «no disponible»; el resto del panel funciona.
14. **Un negocio sin configuración en el cerebro:** aparece sin tope («sin configurar en el cerebro»), no como 0 %.
15. **Medianoche en zonas distintas:** el «hoy» de cada negocio es el de su zona; el total de hoy del resumen suma los «hoy» de cada uno (se dice en la pantalla).
16. **Contraseña obligatoria y el cerebro:** la marca solo bloquea páginas, no `/api/bot/*` ni los webhooks.
17. **Cambiar la contraseña con la actual equivocada:** el error de Better Auth, con el mismo límite de intentos.
18. **Postgres menor que 16 en producción:** la `0034` falla en `WITH INHERIT FALSE` y la app no arranca con un mensaje claro. Coolify usa la imagen `postgres:16` que se eligió (estimación: confirmarlo al desplegar, en el bloque S).
19. **El panel en celular:** las tablas pasan a tarjetas; la pantalla de la contraseña tiene un botón «Copiar» grande.
20. **Un negocio con muchos datos:** las funciones de conteo usan los índices `organization_id` primero que ya existen; si el resumen tarda más de 1 s con los datos del E2E, se mide y se avisa antes de seguir.

---

## 12. Sabotajes

Cada uno debe hacer fallar una prueba por la razón correcta. Los unitarios se corren en local; los marcados con **(PG)** van en PRs borrador contra Postgres real y se cierran sin merge.

1. `datos.ts` lee `message` con `getDb()` → `panel-candado`.
2. Una página de `/admin` importa `src/server/inbox/*` → `panel-candado`.
3. `comoPanel` sin `SET LOCAL ROLE` → `cliente-rls` (unitaria) y **(PG)** «el panel no lee `message`».
4. `GRANT SELECT ON message TO vocero_panel` → **(PG)**.
5. `GRANT vocero_panel TO vocero_app` con herencia → **(PG)** «la app no ejecuta `vocero_panel_*`» y `rls-arranque`.
6. `vocero_panel_negocios` devuelve un `text` de más (por ejemplo, el nombre de un contacto) → guardarraíl de la migración y **(PG)**.
7. El *guard* no mira `twoFactorEnabled` → `panel-guard`.
8. El *guard* acepta una sesión anterior a `totp_activado_en` → `panel-guard`.
9. `/two-factor/disable` abierto → `panel-rutas`.
10. Sin el *trigger* de `member` → **(PG)**.
11. Un negocio pausado despacha lo normal → `negocio-pausado`. Un pausado que no despacha salud → `negocio-pausado`.
12. El personal de un negocio pausado entra → `negocio-pausado`.
13. La contraseña del alta aparece en el registro o en `console` → `panel-datos` (busca la contraseña en todo lo registrado).
14. `/change-password` no limpia `debe_cambiar_contrasena` → `cuenta-contrasena`.
15. **Cerebro:** `/vocero/gasto` acepta una petición de hace 10 min, una firmada con `BOT_API_KEY` sin derivar, o devuelve `conversation_id` → sus pruebas (unitarias y **(PG)** en su CI).

---

## 13. Verificación al cerrar

- **CI de Vocero** en verde en las dos configuraciones, más «RLS contra Postgres» con los casos nuevos.
- **`e2e.yml` completo:** lo de siempre (despacho, consentimiento, contrato, retención, multinegocio y alta), más **panel**. Se mide que `e2e-despacho` no suba más del 20 %; no debería moverse, porque el despacho solo gana una columna en `vocero_membresia` y una condición en `encolar`.
- **CI del cerebro** en verde.
- **Sabotajes:** todos detectados, cada uno por su razón.
- **Revisión visual:** sin `next dev` en este PC. El E2E de Actions toma capturas de `/admin` y `/admin/negocios` a 390 px y 1280 px con Playwright, que ya corre ahí, y las sube como artefacto para que Andres las vea.

---

## 14. Preguntas para Andres (respondidas: las 8 como se recomendaron)

**Matiz de Andres a la 3:** los usuarios sembrados en los E2E de hoy no deben quedar bloqueados por el cambio obligatorio. La marca solo la ponen el alta, el equipo y el restablecimiento; las siembras de los E2E que entran por páginas la dejan en `false` o cambian la contraseña por la API antes de navegar (se revisa guion por guion en T7).

**Matiz de Andres a la 4:** `/admin` muestra cuántas cuentas tiene cada negocio (columna «Usuarios»).

1. **Activar el TOTP:** ¿en la web con un código QR la primera vez que entras (agrega `uqr`, una librería pequeña y sin dependencias), o solo por el comando, que imprime el secreto en texto para teclearlo en la app? **Recomiendo el QR en la web:** es lo normal y evita teclear 32 caracteres. Reiniciarlo queda solo por el comando.
2. **«Pausar» un negocio:** ¿bloquea el panel de su personal, deja el bot como apagado pero **sí** contesta lo de salud (D9), y sigue guardando mensajes, la retención y los borrados? **Recomiendo eso.** La alternativa es cortar también lo de salud; no la recomiendo, porque la seguridad del paciente no depende de un pago.
3. **Contraseñas:** ¿obligar a cambiarla en el primer ingreso cuando la puso otra persona (el alta, el dueño para su equipo, o tu restablecimiento) y subir el mínimo de las nuevas a 12 caracteres? **Recomiendo las dos.**
4. **Tope de cuentas de equipo:** ¿lo dejamos para cuando existan los paquetes? **Recomiendo dejarlo;** el panel te muestra cuántas tiene cada negocio.
5. **Puente del gasto:** ¿llave derivada de `BOT_API_KEY` y URL sacada de `BRAIN_DISPATCH_URL`, sin secretos ni variables nuevas? **Recomiendo eso.**
6. **Sesión del panel:** ¿máximo 12 h y sin «confiar en este dispositivo» (siempre pide el código)? **Recomiendo eso.**
7. **Usuarios desde el panel:** ¿solo ver, restablecer la contraseña y quitar cuentas (nunca al último dueño)? Crear cuentas de equipo lo sigue haciendo el dueño y cambiar de dueño queda para después. **Recomiendo ese alcance.**
8. **Dar el superadmin:** ¿solo con la URL del dueño de la base (`DATABASE_MIGRATIONS_URL`), nunca desde la app? Encaja con la nota del bloque S, que la separará del contenedor web. **Recomiendo eso.**
