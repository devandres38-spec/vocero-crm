# 080 — El Laboratorio con la llave de Aliantis, tope diario y Ajustes → IA fuera del negocio (bloque L)

Fase 5 de Aliantis, paso 5.3. Toca dinero: va solo. Concreta **D20** (el Laboratorio corre con nuestra llave controlada y con un tope diario de corridas por negocio) y el matiz de **D3** (el rol del negocio nunca ve ni edita llaves ni proveedores de IA). Cierra la brecha **N9**.

> Aprobada por Andres el 12-nov-2026, con las siete recomendaciones (P1 a P7, al final). Lo marcado «(P#)» remite a esa respuesta.

## Por qué

- **D20:** hoy el juez del Laboratorio paga con la llave que el negocio pegó en Ajustes → IA, y no hay tope: solo existe el candado de una corrida a la vez.
- **D3 y N9:** Ajustes → IA lo ve y lo edita el negocio. Con D3, la llave es de Aliantis y el negocio no tiene nada que configurar ahí.
- **Pilar 5:** cualquier llamada al LLM pagada por Aliantis va con los proveedores fijos (`deepinfra` y `parasail`), ZDR y `reasoning: none`. El adaptador de Vocero hoy manda solo `{ model, messages }`.

## Lo que hay hoy (verificado en el código, 12-nov-2026)

- **Quién llama al LLM en el Laboratorio:**
  - las personas son guiones fijos (`src/server/lab/personas.ts`, 8 en total): no llaman al LLM;
  - las respuestas del «agente» las da el cerebro conectado: la corrida encola un despacho con `test: true` (`src/server/lab/runner.ts:351`, `turnoPorDespacho`);
  - **en Vocero, el único que llama al LLM es el juez:** `judgeCase` (`src/server/lab/judge.ts:30-61`) usa `chatJson(..., { judge: true, organizationId })`, una llamada por persona.
- **La llave:** `resolveAiProvider` (`src/lib/ai/provider.ts:130-137`) prefiere la fila de `ai_credentials` del negocio; sin fila, `OPENROUTER_*` del entorno. Una fila pausada no cae al entorno. Un 401 o 402 pausa la fila (`src/lib/ai/index.ts`).
  - El cuerpo que sale al proveedor es `{ model, messages }` (`callProvider`, `src/lib/ai/index.ts`): sin enrutamiento de proveedores, sin ZDR y sin `reasoning`.
- **Las corridas:** `agent_test_run` (`src/lib/db/schema.ts:868-890`), con `started_at` y el índice único parcial `test_run_org_running_uq` (una sola corrida `running` por negocio). No hay conteo diario.
  - `POST /api/lab/runs` (`src/app/api/lab/runs/route.ts:46-75`): `withAuth` sin `canConfigure` (cualquier miembro corre el Laboratorio); 409 `sin_cerebro`, 409 `ai_not_configured` y 409 `run_in_progress`.
- **Ajustes → IA:**
  - rutas `src/app/api/settings/ai/route.ts` (GET, PUT, DELETE) y `src/app/api/settings/ai/test/route.ts` (POST), con `withAuth` y **sin** `canConfigure`: cualquier miembro edita o prueba la llave;
  - pantalla `src/app/(app)/settings/ai/page.tsx` + `src/components/settings/ai-client.tsx`; enlace en el menú (`src/lib/nav.ts:131`);
  - la mencionan: la guía de inicio (`src/server/onboarding/guide.ts:76-84`, paso `ai`), la pantalla Agente (`aiConfigured`/`aiMensaje` en `src/app/api/agent/profile/route.ts:27-46` y el recuadro en `agent-client.tsx`), el aviso de IA (`src/server/ai/aviso.ts`, `src/components/avisos/aviso-ia.tsx`), «quién responde» (`src/app/api/agent/brain-status/route.ts:30`) y el Laboratorio (`lab-client.tsx:139-152`).
- **El proxy `/api/bot/llm`** (`src/server/bot/llm-proxy.ts:32-94`) reenvía el cuerpo tal cual con esa misma llave, y `GET /api/bot/profile` anuncia `llm: { path: "/api/bot/llm", model }` (`src/app/api/bot/profile/route.ts:41-43`). **`aliantis-brain` no lo usa:** piensa con su propia `OPENROUTER_API_KEY` (`aliantis-brain/src/llm/openrouter-llm.ts`).
- **El panel de Andres:** escribe solo por funciones `SECURITY DEFINER` `vocero_panel_*` (`drizzle/0034_panel.sql`; patrón `vocero_panel_pausar`, que además anota en `registro_panel`). `tests/unit/panel-candado.test.ts` impide que el panel importe `@/lib/db` o nombre tablas de negocio.
- **La zona del negocio:** `businessTimezone` (`src/server/analytics/period.ts:51`, sale de `calendar_settings`) y `zonedWallClockToUtc` (`src/lib/time/slots.ts:93`).
- **RLS:** `agent_test_run`, `agent_test_case` y `ai_credentials` con política por negocio (`drizzle/0033_rls.sql`). `organization` también, y la app actualiza su fila (Marca, `src/server/apariencia.ts:54`).
- **E2E:** `laboratorio()` en `scripts/e2e-despacho.mjs:1267-1355` (corre en `e2e.yml`, con `OPENROUTER_BASE_URL` → ai-mock). El mismo guion guarda una llave en Ajustes → IA para probar la pausa por 401 (`scripts/e2e-despacho.mjs:527-565`). `e2e-selftest.mjs` también la usa, pero no corre en CI.

## Qué cambia

### 1. La llave del juez es la de Aliantis (D20)

- **Una sola llave en Vocero: la del entorno** (`OPENROUTER_API_TOKEN`, `OPENROUTER_BASE_URL`, `OPENROUTER_JUDGE_MODEL`), que pone Andres en el despliegue. El juez la usa **siempre**; la fila de `ai_credentials` ya no se consulta (P4).
  - `resolveAiProvider` y `estadoIaDe` resuelven solo el entorno. Las funciones puras se simplifican y sus pruebas se reescriben.
  - La pausa por 401/402 deja de existir (no hay fila que pausar): un 401/402 del proveedor deja el caso `judge_failed` con el motivo, como hoy cualquier otro fallo, y un aviso en el log sin la llave.
- **Proveedores fijos (pilar 5)** cuando la base es OpenRouter: el cuerpo agrega lo mismo que manda el cerebro (`aliantis-brain/src/llm/openrouter-llm.ts:125-131`): `reasoning: { effort: "none" }` y `provider: { data_collection: "deny", zdr: true, require_parameters: true, only: ["deepinfra", "parasail"] }` (P6). Con otra base (el mock de pruebas), el cuerpo no cambia.
- **Sin llave en el entorno:** `POST /api/lab/runs` responde `409 laboratorio_sin_llave` («El Laboratorio no está disponible ahora. Avísale a Aliantis.») en lugar de `ai_not_configured`.

### 2. Tope diario de corridas por negocio (D20)

- **Migración `0037`:** `organization.lab_corridas_por_dia integer NOT NULL DEFAULT 3`, con `CHECK (lab_corridas_por_dia BETWEEN 0 AND 20)` (P1). `0` apaga el Laboratorio de ese negocio.
  - `vocero_app` pierde `UPDATE` sobre la tabla y lo recupera solo en las columnas que la app cambia; `lab_corridas_por_dia` y `pausado_en` quedan fuera (P1).
  - **Solo la escribe el panel**, con la función `vocero_panel_tope_laboratorio(p_org text, p_tope integer)` (`SECURITY DEFINER`, mismo patrón que `vocero_panel_pausar`, anota `tope_laboratorio` en `registro_panel` con `{ "tope": n }`).
  - `vocero_panel_negocios()` devuelve además el tope y las corridas de hoy (cuenta en UTC; es un dato de salud, no de pacientes).
- **Qué cuenta (P2):** toda corrida creada desde el inicio del día del negocio (`businessTimezone` + `zonedWallClockToUtc`), cualquiera que sea su estado (`running`, `done` o `failed`): la que falló también gastó.
- **`POST /api/lab/runs`**, en este orden:
  1. `403 forbidden` sin `canConfigure` (P3);
  2. `409 sin_cerebro` (igual que hoy);
  3. `409 laboratorio_sin_llave` (punto 1);
  4. `429 tope_laboratorio`, con el tope y la hora en que se libera (medianoche del negocio) en el mensaje, sin crear nada;
  5. `409 run_in_progress` (igual que hoy).
- **La carrera:** dos POST a la vez no pasan el tope juntos, porque el índice `test_run_org_running_uq` deja una sola corrida `running`; la segunda da `run_in_progress`. El conteo se hace antes de insertar, en la misma transacción que el insert (`startRun` recibe el tope).
- **`GET /api/lab/runs`** devuelve `laboratorio: { corridasHoy, topeDiario, disponible }`. La pantalla dice «Te quedan N corridas hoy», y con el tope alcanzado deshabilita el botón con «Vuelve a estar disponible mañana».
- **El panel de Andres**, en el detalle del negocio: «Laboratorio: X de N corridas hoy» y un campo para cambiar el tope (0 a 20). Ruta `PUT /api/admin/negocios/[id]/laboratorio` (`{ tope }`), con la guarda del panel (superadministrador con TOTP); `422` fuera de 0-20, `404` si el negocio no existe.

### 3. Ajustes → IA sale del negocio (D3, N9)

- **Rutas:** `GET`, `PUT` y `DELETE /api/settings/ai` y `POST /api/settings/ai/test` responden `404` a cualquier sesión de negocio (también `owner` y `admin`). Se dejan como 404 y no se borran los archivos en este bloque, para que el diff sea revisable; los componentes y módulos que solo usaban esa pantalla se borran (`ai-client.tsx`, `probe.ts` si queda sin uso, `settings.ts`).
- **La pantalla:** `/settings/ai` responde `notFound()`. El menú ya no la muestra (`nav.ts`), la guía de inicio pierde el paso `ai`, y la pantalla Agente, el aviso de IA, «quién responde» y el Laboratorio dejan de enlazarla y de hablar de «tu proveedor».
- **La tabla `ai_credentials`** queda sin uso. **(P5)** La migración `0037` borra sus filas (`DELETE FROM ai_credentials`): son llaves de negocios, que por D3 no deben existir, y guardadas cifradas no sirven a nadie. La tabla se elimina en el bloque V, con su RLS.

### 4. El proxy `/api/bot/llm` (P7)

- **Se apaga.** Con la llave de Aliantis, el proxy sería una puerta para gastar sin tope, con cualquier modelo y sin los proveedores fijos, y nuestro cerebro no lo usa. `POST /api/bot/llm/*` responde `404 proxy_apagado` y `GET /api/bot/profile` devuelve `llm: null`. `docs/openapi.json` lo dice. Se registra en `decisiones.md` como función apagada (Suma de Potencias: choca con los pilares 5 y 1 y no hay forma barata de adaptarla).

## `aliantis-brain`

**No cambia.** Ya piensa con su propia llave de OpenRouter de Aliantis, con los proveedores fijos, y marca los turnos de prueba (`esPrueba`), que el panel ve como `pruebasHoyUsd`.

**Observación (no se toca en este bloque):** el gasto de los turnos de prueba **sí cuenta** para el tope diario real del negocio (`spentSince`, `aliantis-brain/src/db/repositories/llm-calls-repository.ts:70-78`, no filtra `es_prueba`). Con el tope de corridas de Vocero, ese gasto queda acotado (a lo más N corridas × 8 personas por día). Si Andres quiere separar los dos topes, es un cambio del cerebro para otro bloque.

## Contrato y documentación

- **`docs/openapi.json`:** `/api/bot/llm/{ruta}` apagado (404 `proxy_apagado`) y `llm: null` en el perfil.
- **`README.md` y `AGENTS.md`:** la llave es de Aliantis (solo entorno), el tope del Laboratorio y quién lo cambia, Ajustes → IA fuera, el proxy apagado; `.env.example` explica que `OPENROUTER_*` es la llave de Aliantis.
- **`aliantis-core`:** `decisiones.md` (bloque L con las respuestas) y `estado.md`, en el último PR del bloque.
- **`RELEVO_ARQUITECTURA.md`:** N9 cerrada, y la fila 13 del Laboratorio, en un PR del espacio.

## Pruebas

- **Unitarias:**
  - el proveedor: solo el entorno, con o sin fila guardada (la fila se ignora); sin entorno, sin configurar;
  - el cuerpo al proveedor: con base OpenRouter lleva `provider` y `reasoning`; con otra base, igual que hoy;
  - el juez: un 401/402 deja `judge_failed` y no escribe en `ai_credentials`;
  - `POST /api/lab/runs`: 403 sin `canConfigure`, 409 `laboratorio_sin_llave`, 429 `tope_laboratorio` sin crear corrida (con el tope en 0 y con N corridas hoy), el conteo en la zona del negocio (una corrida de ayer en hora local no cuenta), el orden de las respuestas;
  - `GET /api/lab/runs` con `laboratorio`;
  - Ajustes → IA: las cuatro rutas en 404 para `owner`, `admin` y `member`; `nav.ts` sin «IA»; la guía de inicio sin el paso `ai`;
  - el proxy: 404 `proxy_apagado`, sin llamar al proveedor; el perfil con `llm: null`;
  - el panel: la ruta del tope (422, 404) y `panel-candado.test.ts` sigue verde;
  - la migración (columna, CHECK, función, borrado de `ai_credentials`).
- **E2E en `e2e.yml`:**
  - `laboratorio()` en `e2e-despacho.mjs`: corre con la llave del entorno (ai-mock), y con el tope en 1 la segunda corrida da `429 tope_laboratorio`; un miembro sin `canConfigure` recibe 403;
  - la sección de la pausa por 401 de `e2e-despacho.mjs:527-565` se reemplaza: Ajustes → IA da 404 y el proxy da 404 `proxy_apagado`;
  - en `e2e-rls.mjs`: como `vocero_app`, actualizar `lab_corridas_por_dia` o `pausado_en` de su propio negocio da `42501` (sin permiso), y cambiar su `name` sigue funcionando; `vocero_panel_tope_laboratorio` sin superadministrador falla.
- **Los demás guiones de `e2e.yml`, iguales.**

## Sabotajes (en borrador, uno por uno con pausa, se cierran sin merge)

1. El juez vuelve a preferir la fila de `ai_credentials`.
2. `POST /api/lab/runs` sin el tope: la corrida N+1 se crea.
3. Contar las corridas en UTC en vez de la zona del negocio.
4. Quitar `provider`/`reasoning` del cuerpo hacia OpenRouter.
5. `PUT /api/settings/ai` vuelve a responder a un `owner`.

## Fuera de alcance

- Separar en el cerebro el gasto de pruebas del tope real (ver la observación).
- Borrar la tabla `ai_credentials` y sus archivos (bloque V).
- Un tope en dólares del Laboratorio en Vocero (el dinero lo mide el cerebro).

## Respuestas de Andres (12-nov-2026): las siete recomendaciones, aprobadas

- **P1. Cuántas corridas por día y dónde se cambia:** **3 por defecto**, de 0 a 20, en una columna de `organization` que solo escribe el panel de Andres. La app actualiza su propia fila (Marca, `apariencia.ts:54`), y `vocero_app` tiene `UPDATE` sobre toda la tabla (`0033_rls.sql:25`); en Postgres, revocar una sola columna no sirve si queda el permiso de tabla. Por eso la `0037` hace `REVOKE UPDATE ON organization FROM vocero_app` y vuelve a dar `UPDATE` **solo** en las columnas que la app sí cambia (`name`, `slug`, `logo`, `metadata` y las de marca), **verificando antes en T3 cuáles escriben la app y Better Auth**. **Hallazgo de la planeación:** `pausado_en` (la pausa de Andres, 076) hoy también la podría escribir la app; con esta lista queda fuera. La función del panel es `SECURITY DEFINER` y no se afecta. Estimación de costo: una corrida son 8 llamadas del juez más los turnos del cerebro; con DeepSeek V4.1 Flash, centavos de dólar (estimación, no medida).
- **P2. Qué cuenta para el tope:** **toda corrida creada hoy en la zona del negocio**, también las fallidas: gastaron.
- **P3. Quién puede correr el Laboratorio:** hoy cualquier miembro; desde este bloque, **solo `canConfigure`** (`owner`/`admin`), 403 para `member`: gasta dinero de Aliantis.
- **P4. La fila de `ai_credentials` ya no vale:** Vocero solo usa la llave del entorno (la de Aliantis). Así un negocio no puede pagar con su propia llave ni con cualquier proveedor.
- **P5. La migración borra las filas de `ai_credentials`** (irreversible): por D3 no deben existir llaves de negocios; la tabla vacía se elimina en el V.
- **P6. Proveedores fijos y `reasoning: none` también en el juez,** con el modelo del entorno (DeepSeek V4.1 Flash, como el cerebro). Aunque las conversaciones del Laboratorio son simuladas, es una llamada pagada por Aliantis y el pilar 5 no tiene excepciones.
- **P7. El proxy `/api/bot/llm` se apaga:** nuestro cerebro no lo usa, y con la llave de Aliantis sería gasto sin tope y sin proveedores fijos. Se registra como función apagada en `decisiones.md`.
