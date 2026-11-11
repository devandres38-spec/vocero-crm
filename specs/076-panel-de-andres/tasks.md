# 076 — Tareas (bloque I, paso 4.6)

**Cómo se trabaja:**
- Un commit por paso, cada uno con las pruebas de su módulo.
- PRs: `vocero-crm` (código y spec), `aliantis-brain` (el puente del gasto, spec `012-gasto-para-el-panel`) y `aliantis-core` (`decisiones.md` y `estado.md`). Un solo merge por repo, con la palabra de Andres.

**Orden pensado para no dejar `main` roto:**
- T2 y T3 crean la base y el candado sin ninguna pantalla.
- `/admin` no existe hasta T5, y nace ya detrás del *guard* con TOTP.
- El gasto (T8) llega al final. Mientras tanto, el resumen dice «no disponible».

- [x] T1 Spec y estas tareas, con las respuestas de Andres.
- [x] T2 **Migración `0034_panel.sql`:**
  - las columnas `user.two_factor_enabled`, `user.debe_cambiar_contrasena` y `organization.pausado_en`;
  - las tablas `two_factor`, `superadministrador` y `registro_panel`;
  - el rol `vocero_panel` con `WITH INHERIT FALSE`;
  - las 8 funciones `vocero_panel_*`, el *trigger* de `member` y `vocero_membresia` con `pausado`.

  También `schema.ts` con `pnpm db:generate` y el guardarraíl de la migración (tipos de las columnas que devuelve cada función; las tablas nuevas sin RLS declaradas). Sabotaje 6 (estático).
- [x] T3 **El candado en el código:**
  - `comoPanel` y `PanelSinSalida` en `contexto.ts`;
  - `SET LOCAL ROLE vocero_panel` y `app.superadmin_id` en `cliente-rls.ts`;
  - `rls-arranque.ts` comprueba que la app no herede el panel;
  - `src/server/panel/datos.ts`;
  - `panel-candado.test.ts`.

  Sabotajes 1, 2, 3 y 5 (unitarios).
- [x] T4 **Superadmin y TOTP:**
  - el comando `superadmin:alta` (con `--reiniciar-segundo-factor`, exige `DATABASE_MIGRATIONS_URL`) y su *bundle* en el `Dockerfile`;
  - el plugin `twoFactor` y los cierres de `/two-factor/*`;
  - `requireSuperadmin` (los 5 pasos) y `rutaDelPanel`;
  - el login en dos pasos y el desvío del superadmin en `/` y `/login`;
  - `/admin/segundo-factor` con el QR (`uqr`).

  Sabotajes 7, 8 y 9.
- [x] T5 **`/admin` de solo lectura:**
  - `PanelShell` y la navegación (escritorio y celular);
  - el Resumen (servicios y atención);
  - Negocios (tabla y tarjetas);
  - el detalle con usuarios;
  - el Registro.
- [x] T6 **Acciones del panel:**
  - el alta desde la web con `crearNegocio()` (contraseña una sola vez y anotada en el registro);
  - pausar y activar, con sus efectos: sesiones cerradas, `NegocioPausado` en la sesión y `encolar.ts` como agente apagado salvo salud;
  - restablecer la contraseña y quitar una cuenta.

  Sabotajes 11, 12 y 13.
- [x] T7 **«Mi cuenta» y contraseñas:**
  - `/cuenta` para todos los roles y `/admin/cuenta`;
  - `/change-password` con `revokeOtherSessions`;
  - mínimo 12 para las nuevas;
  - `debe_cambiar_contrasena` en el alta, en el equipo y en el restablecimiento, con el redireccionamiento del *layout* y el gancho que la limpia;
  - «Mi cuenta» en el menú de `app-nav`.

  Sabotaje 14.
- [x] T8 **Gasto del LLM:**
  - en el cerebro: `0007_gasto_panel.sql`, `POST /vocero/gasto` con la llave derivada, frescura de 5 minutos y sus pruebas (unitarias y de base);
  - en Vocero: `src/server/panel/gasto.ts` (caché de 60 s, zod y degradación) y las barras del Resumen y de Negocios.

  Sabotaje 15 en el CI del cerebro.
- [x] T9 **Verificación contra Postgres real y de punta a punta:**
  - los casos nuevos en `scripts/e2e-rls.mjs`;
  - `scripts/e2e-panel.mjs` y `tests/e2e/us-panel.md`;
  - el paso del panel en `e2e.yml`, con capturas a 390 px y 1280 px como artefacto.

  Sabotajes 3, 4, 5, 6 y 10 contra Postgres real, en PRs borrador que se cierran sin merge. Se mide la duración de `e2e-despacho`.
- [x] T10 **Docs y cierre:**
  - `AGENTS.md`, `README.md` (crear el superadmin y activar el TOTP en Coolify) y `.env.example`;
  - `decisiones.md` y `estado.md` en core, donde queda como pendiente el tope de cuentas con los paquetes y la nota de `DATABASE_MIGRATIONS_URL` para el bloque S.

  Con el CI de los tres repos, «RLS contra Postgres» y `e2e.yml` en verde, se avisa a Andres para el merge.
