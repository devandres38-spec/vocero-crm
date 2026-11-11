# 074 — Alta de negocios solo por Andres y topes por negocio (bloque G, pasos 4.3 y 4.4)

**Estado:** aprobada por Andres y programada con su «arranca» (11-nov-2026). Decisiones base: pilar 1 de Aliantis («la instalación y el alta las hace Andres; no es autoservicio»), D13 (tope por negocio) y D16 (el panel de Andres, que llega en el bloque I); brechas 2 y N7 del relevo.

## Lo verificado en el código (11-nov-2026, `main` en `74485b2`)

**Alta (paso 4.3)**
- `src/server/auth/registration.ts`: `isPublicSignupAllowed()` abre el registro público **mientras no exista ninguna organización** o con `ALLOW_SIGNUP=true` (para siempre y para cualquiera).
- `src/server/auth/on-signup.ts`: `onUserCreated` (gancho `user.create.after` de Better Auth) crea la organización, el dueño, las 5 etapas y el perfil del agente **para el primer usuario que se registre** en una instalación vacía. Es la única forma de crear un negocio hoy, y la hace quien llegue primero a `/register`.
- **Hallazgo: `/api/auth/organization/*` está abierto.** El plugin `organization` de Better Auth 1.6.23 (`src/lib/auth/index.ts`) monta 35 rutas propias, y `allowUserToCreateOrganization` vale `true` por defecto. **Cualquier usuario con sesión, incluso un `member`, puede hacer `POST /api/auth/organization/create` y crear un negocio nuevo del que queda como `owner`.** Las demás rutas (`invite-member`, `update-member-role`, `remove-member`, `delete`, `update`…) se saltan las reglas de roles de la app (`/api/settings/team` exige `owner`): por ejemplo, un dueño podría borrar su organización entera con `organization/delete` (cascada sobre todo). La app no usa ninguna: `authClient` incluye `organizationClient()` pero nadie llama `authClient.organization.*`.
- `src/lib/auth/session.ts` → `resolveMembership(userId)` toma **la primera membresía** (`limit 1`, sin orden). Con un usuario en dos negocios (posible hoy por el hallazgo anterior), el negocio de la sesión sería al azar.
- Las cuentas de equipo (`POST /api/settings/team`, solo `owner`) usan `runInternalSignup`, que atraviesa el cierre del registro; un correo que ya existe da `409 duplicate`, así que un usuario no entra a un segundo negocio por esa vía.
- `src/app/(auth)/register/page.tsx` dice «El primer registro crea la organización de esta instancia», y `login` enlaza a ella.
- `scripts/seed/demo.ts` (`pnpm seed:demo`) carga la demo en **la primera organización** de la tabla (`limit 1`, sin orden). Con varios negocios, puede ir al de un cliente. La ruta de la interfaz (`POST /api/seed/demo`) ya usa la organización de la sesión.
- `scripts/reset-password.mjs` ya hashea con `better-auth/crypto` (`hashPassword`), la misma función del login. No hay pantalla de «cambiar contraseña».
- **E2E:** los arneses de `e2e.yml` crean al operador registrándose en la instalación vacía (`/api/auth/sign-up/email`, y si falla, inician sesión). Al cerrar el registro, necesitan que el operador exista antes.

**Topes (paso 4.4)**
- **N7 ya quedó cerrada en el bloque F:** el presupuesto de `/api/bot/*` va por negocio (`bot-api:{org}`, 1200/min) y «quién responde» también (`markBotSeen(org)`).
- Los demás `checkRateLimit` ya llevan negocio o IP: `embedded:{org}:{user}`, `bot-api-fail:{ip}`, login y registro por IP.
- Las cachés en `globalThis` no mezclan negocios: los tokens de Google y Zoom van por la huella de las credenciales de cada uno; el bus de SSE publica en `org:{id}`; el resto son mocks de desarrollo o estado del proceso.
- El cerebro ya tiene sus topes por negocio (`tope_diario_usd` en el `cliente.yaml` de cada negocio y 30 llamadas por conversación al día en `spend.ts`).
- El Laboratorio permite una corrida a la vez por negocio. Su tope diario es del **bloque L** (D20), no de este.
- **Lo que sigue siendo global: la cola del despacho.** `tanda()` (`src/server/dispatch/worker.ts`) toma hasta 10 despachos cada 2 s, de uno en uno, y `tomarPendientes` los elige **por orden de llegada (`not_before`), sin mirar el negocio.** Si un negocio recibe una ráfaga (una campaña, un ataque de spam a su número), los despachos de los demás esperan detrás de todos los suyos. Es el mismo problema de N7 («un negocio frena a todos») en otra pieza.

**Esquema:** la tabla de bloques marcaba G con «Sí: esquema» pensando en N7, que el bloque F ya resolvió. Con lo propuesto aquí **no hace falta migración**. Si Andres pide el tope de cuentas de equipo (pregunta 3), sí: una columna en `organization`.

## Decisiones propuestas

**4.3 Alta solo por Andres**
- **D1 Registro público cerrado siempre.** `/api/auth/sign-up/email` responde 403 salvo dentro de `runInternalSignup`, con o sin organizaciones. Se quitan `isPublicSignupAllowed`, la regla de «instalación vacía» y `ALLOW_SIGNUP` (`env.ts`, `.env.example`, `AGENTS.md`).
- **D2 Rutas del plugin `organization` cerradas.** `allowUserToCreateOrganization: false` y, en el gancho `before` de Better Auth, **toda** ruta `/organization/*` responde 404. Se cierra la lista entera, no una por una: así una ruta nueva de una versión futura de Better Auth nace cerrada. Se quita `organizationClient()` del cliente. Las tablas `member` e `invitation` siguen; el equipo se maneja solo por `/api/settings/team`.
- **D3 Un usuario, un negocio.** `onUserCreated` deja de crear organizaciones (un usuario nuevo nunca crea un negocio). `resolveMembership` ordena por `createdAt` para que la respuesta sea fija.
- **D4 `crearNegocio()` en `src/server/auth/alta.ts`, en una sola transacción:** organización (`slug` único derivado del nombre), dueño (`user` + `account` con proveedor `credential` y la contraseña hasheada con `hashPassword` de `better-auth/crypto`), membresía `owner`, las 5 etapas y el perfil del agente. Si algo falla, no queda nada a medias. Rechaza un correo que ya exista: el dueño de un negocio no puede ser una cuenta de otro. El candado `pg_advisory_xact_lock` impide dos altas con el mismo correo o slug a la vez. El panel de Andres (bloque I) llamará a esta misma función.
- **D5 `pnpm negocio:alta`** (`scripts/negocio-alta.ts`, mismo patrón que `meta:secreto`): `--nombre "<negocio>" --dueno-correo <correo> --dueno-nombre "<nombre>"`. Genera una contraseña fuerte (`randomBytes`, 24 caracteres base64url) y la muestra **una sola vez** junto con el id del negocio (el que piden `meta:secreto` y `privacidad:sembrar`) y los siguientes pasos. Nunca la escribe en un archivo ni en el registro.
- **D6 `/register`** pasa a decir «Las cuentas las crea Aliantis. Si eres parte de un negocio, pide acceso a su dueño», sin formulario, y `login` deja de enlazarla.
- **D7 `pnpm seed:demo` exige `--organizacion <id>`** y valida que exista; sin ella, sale con el uso.

**4.4 Topes por negocio**
- **D8 Reparto justo del despacho.** En cada tanda, **un negocio toma como máximo 2 despachos mientras otro tenga alguno esperando**; si solo queda uno con despachos, sigue tomando hasta 10 (no se pierde capacidad). Se hace en `tomarPendientes` con una lista de negocios ya servidos en la tanda: primero busca fuera de esa lista y, si no hay, en todos. El orden dentro de cada negocio sigue siendo por llegada, y el lease, los intentos y el despacho único por conversación no cambian.
- **D9 Ningún contador nuevo global.** Un guardarraíl (prueba) revisa que toda clave de `checkRateLimit` en `src/` lleve organización o IP, para que un tope global no vuelva a entrar sin que se note.

## Riesgo de cada paso

| Paso | Riesgo | Por qué |
| --- | --- | --- |
| T2 Cerrar el registro y el plugin | Alto | Toca la autenticación; un error deja fuera a todos o deja abierta la puerta |
| T3 `crearNegocio` y `pnpm negocio:alta` | Medio | Escribe en `user` y `account` sin pasar por Better Auth: el login real tiene que aceptarlo (lo prueba el E2E) |
| T4 Reparto del despacho | Medio | Cambia el orden de la cola; no cambia la entrega ni el lease |
| T5 E2E | Bajo | Solo arneses y `e2e.yml` |

## Archivos

- `src/lib/auth/index.ts` (gancho `before`, opción del plugin), `src/lib/auth/client.ts`, `src/server/auth/registration.ts` (se borra o queda como `registroCerrado`), `src/server/auth/on-signup.ts`, `src/lib/auth/session.ts` o `on-signup.ts` (`resolveMembership` con orden), `src/lib/env.ts`.
- Nuevos: `src/server/auth/alta.ts`, `scripts/negocio-alta.ts` y el script `negocio:alta` en `package.json`.
- `src/app/(auth)/register/page.tsx`, `src/app/(auth)/login/page.tsx`.
- `scripts/seed/demo.ts`.
- `src/server/dispatch/outbox.ts` (`tomarPendientes`), `src/server/dispatch/worker.ts` (`tanda`).
- Pruebas: `registration.test.ts` (se reescribe), nuevas `alta-negocio.test.ts`, `plugin-organizacion-cerrado.test.ts`, `despacho-reparto.test.ts`, `topes-por-negocio.test.ts` (guardarraíl).
- E2E: `scripts/e2e-alta.mjs`, `tests/e2e/us-alta.md`, `.github/workflows/e2e.yml`.
- Docs: `AGENTS.md`, `.env.example`, `specs/001-vocero-core/quickstart.md`, `README.md` si menciona el registro. En `aliantis-core`: `decisiones.md` y `estado.md`.

## Casos borde

1. Instalación vacía: nadie puede registrarse; el primer negocio también se crea con `pnpm negocio:alta`.
2. `ALLOW_SIGNUP=true` que quedó en un `.env` viejo: se ignora (y `pnpm doctor` avisa que sobra).
3. El dueño de un negocio crea una cuenta de equipo: sigue funcionando (`runInternalSignup`).
4. Un `member` llama `POST /api/auth/organization/create` o `set-active`: 404, y no se crea nada.
5. Un dueño llama `organization/delete` sobre su propio negocio: 404; el negocio sigue.
6. `negocio:alta` con un correo que ya existe (en otro negocio o como cuenta de equipo): sale con error y no crea nada.
7. Dos negocios con el mismo nombre: slugs distintos (`clinica-sonrisa`, `clinica-sonrisa-2`).
8. Falla a mitad del alta (por ejemplo, la inserción de etapas): la transacción se deshace; no queda usuario huérfano.
9. El dueño recién creado inicia sesión: entra a su negocio, con sus 5 etapas y el Agente apagado, y no ve nada de otro.
10. Negocio A con 30 despachos pendientes y B con 1: B sale en la primera tanda.
11. Solo A tiene despachos: la tanda toma 10, como hoy.
12. Un despacho de A con lease vencido: vuelve a la cola y respeta el mismo reparto.
13. `pnpm seed:demo` sin `--organizacion`: no toca ningún negocio.

## Sabotajes (8)

| # | Sabotaje | Lo detecta |
| --- | --- | --- |
| 1 | Registro abierto con la instalación vacía | `registration.test.ts` |
| 2 | `ALLOW_SIGNUP=true` vuelve a abrir el registro | `registration.test.ts` |
| 3 | `organization/create` permitido | `plugin-organizacion-cerrado.test.ts` |
| 4 | Se cierra solo `organization/create` y no el resto (por ejemplo, `delete`) | `plugin-organizacion-cerrado.test.ts` |
| 5 | El alta fuera de transacción (queda el usuario si fallan las etapas) | `alta-negocio.test.ts` |
| 6 | El alta acepta un correo que ya existe | `alta-negocio.test.ts` |
| 7 | La tanda vuelve al orden por llegada sin reparto | `despacho-reparto.test.ts` |
| 8 | Un `checkRateLimit` con clave global | `topes-por-negocio.test.ts` |

Los sabotajes 3 y 4 se prueban contra la instancia real de Better Auth con una base simulada, no contra un mock del gancho.

## Verificación

- **En el PC:** `vitest run` de las pruebas tocadas, los 8 sabotajes, prettier y eslint de los archivos tocados y un `tsc --noEmit` antes del push. Sin migración, no hace falta `db:generate`.
- **CI de GitHub:** los cuatro gates en las dos configuraciones.
- **`e2e.yml`** (toca auth y despacho): un paso nuevo antes de los arneses crea al operador con `pnpm negocio:alta`. Los arneses ya caen a «iniciar sesión» si el registro falla, así que no cambian. Los cinco E2E de hoy siguen verdes y se suma `e2e-alta`:
  - registro público → 403;
  - `organization/create` con la sesión del operador → 404;
  - `negocio:alta` crea un segundo negocio;
  - su dueño inicia sesión, ve sus 5 etapas y no ve las conversaciones del operador;
  - repetir el correo → error, sin filas nuevas.
- **Reparto del despacho en E2E:** no; lo cubre la prueba unitaria contra la consulta real (`QueryBuilder`). Medirlo con carga real necesitaría un cerebro lento a propósito y no aporta más que la prueba.

## Lo que esta spec no hace

- El panel de Andres, su segundo factor y el alta desde la web: bloque I (D16). Este bloque deja `crearNegocio()` lista para que el panel la use.
- RLS: bloque H.
- El tope diario del Laboratorio y sacar Ajustes → IA del rol del negocio: bloque L.
- Suspender o borrar un negocio: no se pidió; queda para el panel (bloque I) si Andres lo quiere.
- Los arneses viejos que no corren en `e2e.yml` (`e2e-roles`, `e2e-alta-manual`…) se registran en una instalación vacía. Con el registro cerrado, necesitan el operador creado antes, como los del CI: `node scripts/e2e-operador.mjs` (el de `e2e@vocero.test`) o un `pnpm negocio:alta` con su correo. Se dice una vez en `quickstart.md`, no en la cabecera de cada uno, y se arreglan cuando vuelvan a correr.

## Respuestas de Andres (11-nov-2026)

1. **Contraseña del dueño:** `pnpm negocio:alta` genera una fuerte y la muestra **una sola vez** en la terminal. La pantalla de «cambiar contraseña» queda para el bloque I.
2. **Reparto justo del despacho:** entra en este bloque.
3. **Tope de cuentas de equipo por paquete:** no por ahora; se ve en el bloque I. Sin migración.
4. **Un correo, un negocio:** sí; ni un dueño ni una cuenta de equipo pertenecen a dos negocios.
