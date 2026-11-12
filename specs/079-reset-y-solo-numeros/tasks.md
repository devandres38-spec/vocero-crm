# Tareas — 079 `reset` solo en el Laboratorio y «solo estos números» (bloque K)

Un commit por tarea, cada uno con sus pruebas unitarias. Si aparece algo fuera del plan, se para y se pregunta.

- [x] **T1 — Spec y tareas** (aprobados por Andres el 12-nov-2026, con sus cuatro respuestas ya dentro del spec).
- [x] **T2 — `reset` solo en el Laboratorio:**
  - `src/app/api/bot/reset/route.ts` lee `isTest`; fuera de prueba, `409 solo_laboratorio` sin escribir nada;
  - prueba `tests/unit/reset-laboratorio.test.ts`;
  - `docs/openapi.json`.
- [x] **T3 — Migración `0036_solo_numeros`:**
  - `agent_profile.solo_numeros_activo`, `solo_numeros` y su CHECK (máximo 50), con `pnpm db:generate`;
  - prueba de la migración.
- [x] **T4 — La regla `permitidoPorLista`** (`src/server/dispatch/solo-numeros.ts`) y su prueba.
- [x] **T5 — Las dos puertas del despacho:**
  - `encolar.ts` (lee la identidad y la lista);
  - `deliver.ts` (`construirEvento` trae la lista);
  - `worker.ts` (descarta con el motivo);
  - salud y `is_test` como dice la spec;
  - pruebas.
- [x] **T6 — El perfil del Agente:**
  - antes de tocar la ruta, revisar las pruebas y guiones E2E que llamen a `PUT /api/agent/profile` con un rol sin `canConfigure`;
  - `PUT /api/agent/profile` con `soloNumeros`: limpia espacios, `+`, guiones, puntos y paréntesis, valida 11-15 dígitos, aplica `normalizeMx`, quita repetidos y da los errores; `canConfigure` en toda la ruta;
  - `GET` la devuelve;
  - la pantalla del Agente (interruptor, campo y aviso de que Instagram, Messenger y TikTok quedan para una persona);
  - pruebas de la ruta.
- [x] **T7 — E2E:**
  - `resetYSoloNumeros()` en `scripts/e2e-contrato-aliantis.mjs`;
  - el aislamiento en `scripts/e2e-rls.mjs`;
  - `tests/e2e/us-contrato-aliantis.md`.
- [x] **T8 — Documentación:**
  - `README.md` y `AGENTS.md`;
  - en `aliantis-core`, `decisiones.md` y `estado.md` (último PR del bloque);
  - el espacio: la fila de N3 en la tabla de brechas de `RELEVO_ARQUITECTURA.md`, si queda cerrada.
- [ ] **T9 — Verificación:**
  - el CI y `e2e.yml` (etiqueta `e2e`) en verde;
  - los 4 sabotajes en borrador, uno por uno con pausa, cerrados sin merge;
  - el informe corto.

## Ajustes al implementar (sin cambiar el comportamiento)

- **T5:** `construirEvento` no cambió. La lista no viaja en el evento (el cuerpo es contrato firmado byte a byte con el cerebro, y los números de otros clientes no son asunto suyo): `procesar` la relee aparte con `leerListaDeNumeros`, y la decisión de descarte quedó en `motivoDeDescarte` (exportada, con prueba que pasa por `tanda()`, para que el sabotaje 2 caiga en una prueba unitaria).
- **T6:** `soloNumeros` no va en `docs/openapi.json`: ese contrato solo documenta la superficie del cerebro (`/api/bot/*`), y la lista no se le expone. Va en el README y en AGENTS.md.

## En el PC (3,9 GB)

Solo `vitest run <archivos tocados>`, eslint de los archivos tocados, `pnpm db:generate` en T3 y un `tsc --noEmit` antes de subir. Nada de prettier en este repo.
