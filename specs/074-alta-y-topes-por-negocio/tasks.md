# 074 — Tareas (bloque G)

Un commit por paso, cada uno con las pruebas de su módulo. PRs: `vocero-crm` (código y spec) y `aliantis-core` (`decisiones.md` y `estado.md`). El cerebro no cambia. Un solo merge.

- [x] T1 Spec y estas tareas, con las respuestas de Andres (11-nov-2026).
- [x] T2 (4.3) Registro público cerrado siempre (fuera `ALLOW_SIGNUP` y la regla de la instalación vacía); `/organization/*` en 404 y `allowUserToCreateOrganization: false`; fuera `organizationClient()`; `onUserCreated` ya no crea negocios; `resolveMembership` con orden; `/register` sin formulario y `login` sin el enlace; `pnpm doctor` avisa si sobra `ALLOW_SIGNUP`. Sabotajes 1 a 4.
- [x] T3 (4.3) `crearNegocio()` en `src/server/auth/alta.ts` (una transacción, correo único, slug único, candado) y `pnpm negocio:alta`; `pnpm seed:demo` exige `--organizacion`. Sabotajes 5 y 6.
- [x] T4 (4.4) Reparto justo del despacho por negocio en `tomarPendientes` y `tanda`; guardarraíl de claves de `checkRateLimit`. Sabotajes 7 y 8.
- [ ] T5 `e2e.yml` crea al operador con `pnpm negocio:alta` antes de los arneses; `scripts/e2e-alta.mjs` y `tests/e2e/us-alta.md`, en `e2e.yml`.
- [ ] T6 `AGENTS.md`, `.env.example`, `quickstart.md`, `README.md`, `decisiones.md` y `estado.md`. CI y `e2e.yml` en verde.
