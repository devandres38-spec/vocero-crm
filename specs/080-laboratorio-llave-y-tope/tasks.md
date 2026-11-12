# Tareas — 080 El Laboratorio con la llave de Aliantis, tope diario y Ajustes → IA fuera del negocio (bloque L)

Un commit por tarea, cada uno con sus pruebas unitarias. Si aparece algo fuera del plan, se para y se pregunta.

- [x] **T1 — Spec y tareas** (aprobados por Andres el 12-nov-2026, con las siete recomendaciones P1 a P7).
- [x] **T2 — La llave de Aliantis y los proveedores fijos:**
  - `src/lib/ai/provider.ts`: solo el entorno; la fila de `ai_credentials` ya no se consulta (P4);
  - `src/lib/ai/index.ts`: sin pausa por 401/402; con base OpenRouter, el mismo `provider` y `reasoning` que el cerebro (`deepinfra` y `parasail`, ZDR, `data_collection: "deny"`, `require_parameters`, `effort: "none"`) (P6);
  - pruebas: `ai-config.test.ts` y las del adaptador, reescritas; el juez con 401 queda `judge_failed`.
- [x] **T3 — Migración `0037_laboratorio_tope`:**
  - `organization.lab_corridas_por_dia` (por defecto 3, CHECK 0-20), con `pnpm db:generate`;
  - a mano: `REVOKE UPDATE ON organization FROM vocero_app` y `GRANT UPDATE (<columnas de la app>)`, revisando antes qué columnas cambian la app y Better Auth;
  - `vocero_panel_tope_laboratorio` y `vocero_panel_negocios` con el tope y las corridas de hoy;
  - `DELETE FROM ai_credentials` (P5);
  - prueba de la migración.
- [x] **T4 — El tope en el Laboratorio:**
  - `src/server/lab/tope.ts`: corridas de hoy en la zona del negocio (`businessTimezone`, `zonedWallClockToUtc`) y la hora en que se libera;
  - `POST /api/lab/runs`: `403` sin `canConfigure` (P3), `409 laboratorio_sin_llave`, `429 tope_laboratorio`, en el orden de la spec; `startRun` cuenta e inserta en la misma transacción;
  - `GET /api/lab/runs` con `laboratorio`;
  - la pantalla del Laboratorio (corridas que quedan, botón deshabilitado, sin enlace a Ajustes → IA);
  - pruebas de la ruta y del conteo.
- [x] **T5 — El tope en el panel de Andres:**
  - `PUT /api/admin/negocios/[id]/laboratorio` con la guarda del panel (`422`, `404`);
  - `src/server/panel/datos.ts` (`topeLaboratorioDesdeElPanel`) y el detalle del negocio en `/admin`;
  - pruebas; `panel-candado.test.ts` en verde.
- [x] **T6 — Ajustes → IA fuera del negocio y el proxy apagado:**
  - las cuatro rutas de `/api/settings/ai` en `404`; `/settings/ai` con `notFound()`;
  - `nav.ts`, la guía de inicio (sin el paso `ai`), la pantalla Agente, el aviso de IA, «quién responde» y el Laboratorio sin «tu proveedor»;
  - `POST /api/bot/llm/*` en `404 proxy_apagado` y `llm: null` en `GET /api/bot/profile` (P7); `docs/openapi.json`;
  - borrar lo que quede sin uso (`ai-client.tsx` y lo que dependa solo de él);
  - pruebas: las rutas en 404 por rol, `nav.test.ts`, `onboarding-guide.test.ts`, `onboarding-status.test.ts`, `ai-client.test.ts` (se borra o se reescribe), el proxy y el perfil.
- [x] **T7 — E2E:**
  - `laboratorio()` en `scripts/e2e-despacho.mjs` con el tope (`429`) y el `403` de un miembro;
  - la sección de la pausa por 401 (`e2e-despacho.mjs:527-565`) reemplazada por Ajustes → IA en 404 y el proxy en 404;
  - `scripts/e2e-rls.mjs`: el `42501` en `lab_corridas_por_dia` y `pausado_en`, `name` sí, y la función del panel sin superadministrador;
  - `e2e-selftest.mjs` (no corre en CI): quitar lo de Ajustes → IA para que no quede roto;
  - los guiones `tests/e2e/*.md` que hablan de Ajustes → IA (`us3-agent.md`, `us-guia-de-inicio.md`).
- [ ] **T8 — Documentación:**
  - `README.md`, `AGENTS.md`, `.env.example` y el `CLAUDE.md` de este repo (la tabla que nombra Ajustes → IA);
  - en `aliantis-core`, `decisiones.md` y `estado.md` (último PR del bloque);
  - el espacio: N9 cerrada y la fila 13 en `RELEVO_ARQUITECTURA.md`.
- [ ] **T9 — Verificación:**
  - el CI y `e2e.yml` (etiqueta `e2e`) en verde;
  - los 5 sabotajes en borrador, uno por uno con pausa, cerrados sin merge;
  - el informe corto.

## `aliantis-brain`

No cambia (ver la spec). Sin PR ni medición real: no cambian el prompt ni el decisor.

## En el PC (3,9 GB)

Solo `vitest run <archivos tocados>`, eslint de los archivos tocados, `pnpm db:generate` en T3 y un `tsc --noEmit` antes de subir. Nada de prettier, `next build`, `next dev`, E2E, Docker ni la suite completa.
