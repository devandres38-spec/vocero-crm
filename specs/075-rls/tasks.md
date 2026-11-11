# 075 — Tareas (bloque H, solo)

Un commit por paso, cada uno con las pruebas de su módulo. PRs: `vocero-crm` (código y spec) y `aliantis-core` (`decisiones.md` y `estado.md`). El cerebro no cambia. Un solo merge.

**Orden pensado para no dejar `main` roto:** T3 deja el envoltorio en modo «avisar» (registra la consulta sin contexto y la deja pasar). T4 a T7 fijan el negocio en todos los puntos de entrada. Recién T8 lo cambia a «lanzar» y conecta la app con el usuario restringido en el E2E. Así cada commit intermedio pasa el CI.

- [x] T1 Spec y estas tareas, con las respuestas de Andres.
- [x] T2 Migración `0033_rls.sql`: rol `vocero_app` y permisos; RLS y política en las 37 tablas con `organization_id` y en `organization`; las funciones `SECURITY DEFINER` de D5 (con `search_path`, sin `PUBLIC`). `rls-guardarrailes.test.ts` (estático: tablas contra políticas y funciones con `search_path`). Sabotajes 1, 7 y 11.
- [x] T3 `contexto.ts` y `cliente-rls.ts` (`conNegocio`, `comoSistema`, `set_config` local en *pipeline*, `db.transaction`, `dbDeCuentas`), `DATABASE_MIGRATIONS_URL` y `migrate.mjs` (asegura el usuario de la app), chequeo del arranque (`rls-arranque.ts`). Sabotajes 3, 4, 5 y 8 (unitarios).
- [ ] T4 Sesión y cerebro: `withAuth` y `conSesion` (8 páginas y `/api/events`), `vocero_membresia`, `rutaDelCerebro` en las 16 rutas, `organizaciones.ts` por D5, marca sin sesión por defecto, `/api/health` por D5. Guardarraíl de rutas. Sabotaje 9.
- [ ] T5 Webhooks: `vocero_negocio_por_canal` en `organizacion.ts`, verificación y guardado en `conNegocio`, barrido y purga por D5, Zernio y TikTok.
- [ ] T6 Workers y arranque: despacho (con el reparto del bloque G en `vocero_despachos_vencidos`), próxima cita, olvidos, avisos, retención, corridas huérfanas y cifrado de Zernio en el arranque, Laboratorio. Sabotaje 10.
- [ ] T7 CLI (`negocio:alta` con contexto en el id nuevo y `vocero_slugs_ocupados`, `meta:secreto`, `privacidad:sembrar`, `avisos:grupo`, `seed:demo`) y mocks de desarrollo.
- [ ] T8 Envoltorio en «lanzar»; `scripts/e2e-rls.mjs` y `tests/e2e/us-rls.md`; job «RLS contra Postgres» en `ci.yml`; `e2e.yml` con el usuario restringido y la migración `0033` sobre datos de dos negocios. Sabotajes 2 y 6 (y 1, 3, 4, 5, 7 y 8 otra vez, ahora contra Postgres real, en PRs borrador que se cierran sin merge).
- [ ] T9 `AGENTS.md`, `.env.example`, `docker-compose.yml`, `README.md` (despliegue con dos URLs), `decisiones.md` y `estado.md`. CI, «RLS contra Postgres» y `e2e.yml` en verde.
