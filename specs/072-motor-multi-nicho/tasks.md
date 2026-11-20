# Tasks: Motor Multi-Nicho (072)

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [contracts/](contracts/)
**Estado**: D1–D22 aprobadas (2026-11-19). **Ronda 072-A hecha** (A0–A6 + cierre local, 2.12.0), subida sin merge; pendiente auditoría, CI y staging (T048–T050). Ronda 072-B sin empezar.

Convenciones: `[P]` paralelizable · `[crm]` `vocero-crm` · `[nea]` `nea-agent` ·
`[local]` gate en este equipo · `[CI]` · `[staging]`.

Gates locales (PC de gama baja, ROADMAP §2.4):
- `[crm]` `npx pnpm@11.5.0 typecheck` · `npx pnpm@11.5.0 lint` ·
  `npx pnpm@11.5.0 exec vitest run --maxWorkers=1 --no-file-parallelism <archivos afectados>`
- `[nea]` `python -m pytest -q` (venv temporal del scratchpad)

Cada bloque cierra con su gate en verde y **un commit**. Nada de `next build`,
Docker ni E2E en local.

---

# Ronda 072-A — Packs, Ficha flexible, Plantillas, Personas (2.12.0)

## Bloque A0 — Red de seguridad `[crm]` `[nea]`

- [x] T001 `[crm]` Instantánea de `appNavGroups` y `settingsSections` actuales (con/sin agenda, cada rol) en `src/lib/nav.test.ts` — hecho en `tests/unit/red-072.test.ts` (menú por rol y agenda, Ajustes completo)
- [x] T002 `[crm]` Prueba de la raíz: sin pack → `/onboarding` | `/inbox` como hoy — cubierto por `onboarding-page.test.ts` (sin cambios) + `inicio-072.test.ts`
- [x] T003 `[crm]` Prueba de `PUT /api/brains/ficha` y `/api/bot/ficha` sin esquema: respuesta byte a byte
- [x] T004 `[nea]` Confirmar dorados B0 (`tests/test_chasis_dorado.py`) en verde y añadir prueba de catálogo de herramientas sin `fichaSchema` = actual
- [x] T005 `[local]` gates — commit «072 A0: red de seguridad»

## Bloque A1 — Modelo y registro de packs `[crm]` (D2, D3, D5, D21)

- [x] T006 Migración `0032_motor_nicho` (plan §3) + columnas en `schema.ts`; re-ejecutable
- [x] T007 `src/verticals/tipos.ts`, `extender.ts`, `registro.ts` (`PACKS as const satisfies`, `PackId`, `esPackId`)
- [x] T008 [P] `src/verticals/default/pack.ts` (vacío = 2.11.0)
- [x] T009 [P] `src/verticals/clinica-salud/pack.ts` (plan §4)
- [x] T010 [P] `src/verticals/eventos-mobiliario/pack.ts` (plan §4)
- [x] T011 `src/verticals/resolver.ts` + `verticalOverridesSchema` (zod `.strict()`, ≤4 KB)
- [x] T012 `src/server/verticals/experiencia.ts` (`cache()`; pack desconocido → `default` + log)
- [x] T013 Pruebas: semillas válidas contra `blueprintSchema`; herencia de un nivel; `src/verticals/**` sin imports prohibidos; overrides basura = ignorados
- [x] T014 `[local]` gates — commit «072 A1: registro de Vertical Packs»

## Bloque A2 — Navegación, vocabulario e Inicio `[crm]` (D4, D6, D7, D8) · US2

- [x] T015 `nav.ts`: `appNavGroups({..., experiencia})`, `ICONOS_NAV`, orden/ocultas; sin experiencia = instantánea T001
- [x] T016 `src/verticals/vocabulario.ts` `t(exp, termino, n)`; aplicar en nav, `<h1>` y estado vacío de Bandeja, Pipeline, Contactos, Citas y título de `FichaPanel` — los títulos son `<h2>` (no hay `<h1>` en esas pantallas); vocabulario por contexto `useVocabulario` en el Shell
- [x] T017 `(app)/layout.tsx` → `experienciaDe()` → `AppShell`/`AppNav` por prop (serializable)
- [x] T018 `src/app/page.tsx`: `experiencia.inicio ? "/inicio" : "/inbox"` tras `guideFirst`
- [x] T019 `(app)/inicio/page.tsx` + widgets del núcleo en `src/components/inicio/widgets/` (`sin_responder`, `leads_por_etapa`, `citas_de_hoy`, `proximos_por_fecha`, `accesos_rapidos`), cada uno con `Suspense` y límite de error; sin `inicio` en el pack → `notFound()` — widgets en `src/components/inicio/widgets.tsx` + consultas en `src/server/inicio/widgets.ts`; el «límite de error» es un try/catch por widget
- [ ] ~~T020 [P] Tema `fiesta` en `TEMAS`~~ — **descartado a propósito**: un tema nuevo exige su pareja oscura y ~40 tokens con contraste; los packs sugieren un tema existente + acento de los presets (clínica: `papel` + verde apagado; eventos: `vocero` + azul acero)
- [x] T021 Pruebas: nav por pack, vocabulario, widgets filtran por `organizationId` (A↛B), `citas_de_hoy` oculto sin agenda
- [x] T022 `[local]` gates — commit «072 A2: navegación, vocabulario e Inicio por nicho»

## Bloque A3 — Ficha flexible en el CRM `[crm]` (D9, D10, D12) · US3

- [x] T023 `src/server/ficha/esquema.ts`: `fichaFieldsSchema`, `aplicarEsquema()` (coerción `es-CO`, `ignored`), `faltantes()` — lo puro en `src/lib/ficha-campos.ts` (lo usa también el cliente); lectura/escritura en `src/server/ficha/esquema.ts`
- [x] T024 `upsertFicha` aplica el esquema; respuesta suma `ignored` solo si no está vacío (T003 sigue verde)
- [x] T025 `fichaSchema` en `contextoDeConversacion` (sirve a `/api/bot/context` y `/api/brains/context`); OpenAPI `docs/openapi.json` y `docs/openapi-brains.json`
- [x] T026 `GET/PUT /api/settings/ficha-fields` (rol que configura; clave y tipo inmutables; 409 `tipo_inmutable`) — SIN soporte de configuración: la lista de rutas que lo admiten es decisión de producto (`soporte-rutas-configuracion`); la agencia usa el Blueprint
- [x] T027 Ajustes → Ficha (`settings/ficha`): editor, reordenar, vista previa, aviso al quitar campo con valores; entrada en `settingsSections`
- [x] T028 `FichaPanel` con controles por tipo + «Otros datos»
- [x] T029 Pruebas: coerción por tipo, `ignored`, claves fuera del esquema, quitar campo conserva valores, A↛B en ajustes
- [x] T030 `[local]` gates — commit «072 A3: ficha flexible por negocio»

## Bloque A4 — Ficha dinámica en Nea `[nea]` (D11) · US4

- [x] T031 `app/herramientas/ficha.py`: `esquema_de_ficha(context)` dinámico y defensivo; `builtin.py` lo usa
- [x] T032 `faltantes(context)` (≤3, en orden) y línea «Datos por reunir» en `app/prompt.py` solo con faltantes
- [x] T033 `_update_ficha` devuelve `ignorados` cuando el CRM los manda
- [x] T034 Pruebas `test_ficha_dinamica_072.py`, `test_datos_por_reunir_072.py`; dorados nuevos `tests/fixtures/prompt/cloud_con_ficha.txt`; B0 intactos; prueba de tamaño (20 campos ≤ +900 tokens estimados) — un solo archivo `test_ficha_dinamica_072.py` (incluye datos por reunir); dorado `072_cloud_con_ficha.txt`
- [x] T035 `[local]` pytest — commit «072 A4: update_ficha según la ficha del negocio»

## Bloque A5 — Plantillas, Blueprint, panel y MCP `[crm]` (D20) · US1

- [x] T036 Blueprint: secciones `vertical` y `fichaFields` (contrato blueprint-072) + `secciones/vertical.ts`, `secciones/ficha.ts` en `aplicar.ts`/`exportar.ts`
- [x] T037 `/platform/nuevo`: «Empezar desde plantilla» (precarga del `FormularioBlueprint`) + pestaña «Nicho»
- [x] T038 Ficha de negocio en `/platform/organizaciones/[id]`: cambiar pack, overrides, «Aplicar plantilla» con dry-run (`plan_blueprint`) — por el mismo formulario: pestaña «Nicho y ficha» con «Cargar plantilla» → «Revisar cambios» (dry-run). Los `overrides` se editan por JSON avanzado / MCP (sin UI propia)
- [x] T039 MCP `list_vertical_packs`, `get_vertical_pack`; `get_catalog` con `verticalPacks` y `fichaFields`; `docs/plataforma-mcp.md`
- [x] T040 Pruebas: plantilla aplicada dos veces → `sin_cambios`; Blueprint de la 071 idéntico; cambiar pack no reaplica semilla; auditoría registra secciones
- [x] T041 `[local]` gates — commit «072 A5: plantillas de nicho en plataforma, Blueprint y MCP»

## Bloque A6 — Personas por nicho `[crm]` (D19) · US5

- [x] T042 `personas.ts`: universales + aportes del pack; `personasDe(experiencia)`; rangos de teléfono — `personasDelPack(packId, delRol)` + `UNIVERSALES` + `TODAS_LAS_PERSONAS`
- [x] T043 Laboratorio usa `personasDe`; `default` = 8 actuales
- [x] T044 Pruebas: sin choques de teléfono entre packs; `default` sin cambios
- [x] T045 `[local]` gates — commit «072 A6: personas del Laboratorio por nicho»

## Bloque AZ — Cierre de 072-A

- [x] T046 `[crm]` Versión 2.12.0, `CHANGELOG.md`, `AGENTS.md`/`CLAUDE.md` (mapa: `src/verticals/`), guion `tests/e2e/072-motor-multi-nicho.md` (parte A) y extensión de `scripts/e2e-plataforma.mjs` — la extensión de `scripts/e2e-plataforma.mjs` queda para staging (guion `.md` escrito; el arnés no se puede correr en este equipo)
- [x] T047 `[nea]` `CHANGELOG.md`
- [x] T048 `[CI]` build + Vitest completo + pytest con Postgres — corre en `main` con el merge de cierre
- [x] T049 `[staging]` Un negocio por pack: capturas de menú/Inicio/ficha; Laboratorio «evento corporativo» con juez (SC-3); `default` sin cambios — validado por el dueño en staging (`clinica-salud` 5 campos, `eventos-mobiliario` 6 campos, `PUT /api/brains/ficha` 200, `default` intacto)
- [x] T050 Merge `--no-ff` de 072-A a `main` en ambos repos (aprobado por el dueño, 2026-11-19)

---

# Ronda 072-B — Módulos y Puente de herramientas (2.13.0)

## Bloque B1 — Marco de módulos `[crm]` (D2, D16, D17)

- [x] T051 `src/modulos/tipos.ts` (`defineModulo`, `ModuleTool`, `Efecto`), `registro.ts`, `registro-cliente.ts`; `CATALOGO_VERTICAL` derivado del registro — datos en `catalogo.ts` (lo importa código de cliente) y herramientas en `registro.ts` (solo servidor)
- [x] T052 `src/server/modulos/guardas.ts`: `exigirModulo`, `withModulo`
- [x] T053 Experiencia: aportes de módulos efectivos (nav, widgets, secciones de ficha) — `ContactPanel` monta secciones vía `registro-cliente`
- [x] T054 Módulo `diagnostico` (oculto): `/m/diagnostico` (página mínima) con `layout.tsx` guardado
- [x] T055 Pruebas-guardarraíl: carpetas `m/*` con guarda; `api/m/*` con `withModulo`; el núcleo no importa `src/modulos/*` fuera de los registros; prefijos de href/herramienta; A↛B en `/m/*`
- [x] T056 `[local]` gates — commit «072 B1: marco de módulos aislados»

## Bloque B2 — Puente en el CRM `[crm]` (D13, D14, D18, D21)

- [x] T057 Migración `0033_llamadas_de_herramienta` + tabla en `schema.ts`; purga >30 días en la retención
- [x] T058 `src/server/brains/herramientas.ts`: `moduleToolsDe(orgId)` (JSON Schema con `z.toJSONSchema`, límites de tamaño/cantidad, reservados)
- [x] T059 `moduleTools` en `contextoDelCerebro` (solo `brains`)
- [x] T060 `POST /api/brains/tools/[name]` (plan §2.5, pasos 1–8) con `withBrain`
- [x] T061 Herramientas `diagnostico_eco` (lectura) y `diagnostico_marca` (escritura: nota de sistema)
- [x] T062 Pruebas `brains-tools.test.ts`: cada código del contrato, módulo apagado = inexistente, A↛B, idempotencia (repetición, en curso, fallida reintenta), timeout con `AbortSignal`, resultado >4 KB
- [x] T063 `docs/openapi-brains.json` + `docs/plataforma-cerebro.md`
- [x] T064 `[local]` gates — commit «072 B2: puente de herramientas de módulo en el CRM»

## Bloque B3 — Puente en Nea `[nea]` (D15)

- [x] T065 `app/herramientas/dinamicas.py`: `validar(context)`, `RESERVADOS`, `registro_del_turno(caps)` (sin herramientas → misma instancia `REGISTRO`)
- [x] T066 `tool_schemas`, `solo_encendidas`, `ToolRuntime.execute`/`_permitida` usan el registro del turno; claves `modulo:*` permitidas solo si vinieron en el contexto
- [x] T067 `BrainsCrmClient.call_tool` + mapeo de errores (contrato brains-072 §4); `RUTAS` intacto
- [x] T068 Línea única de herramientas propias en CONTEXTO ACTUAL (solo si hay)
- [x] T069 Pruebas `test_herramientas_dinamicas_072.py`: colisión con nativa/reservada, patrón, tamaños, >8, registro por turno sin fuga entre dos organizaciones concurrentes, `CrmRechazo` en 401, 404/409/422/504; dorado nuevo `cloud_con_herramientas.txt`; B0 intactos — el archivo se llama `072b_cloud_con_herramientas.txt` (mismo prefijo que `072_cloud_con_ficha.txt`)
- [x] T070 `[local]` pytest — commit «072 B3: herramientas de módulo en el cerebro»

## Bloque BZ — Cierre de 072-B

- [x] T071 `[crm]` Versión 2.13.0, `CHANGELOG.md`, guion E2E parte B; `[nea]` `CHANGELOG.md`
- [x] T072 `[CI]` build + Vitest + pytest con Postgres — corre en `main` con el merge de cierre
- [x] T073 `[staging]` SC-5: `diagnostico_eco` por Nea `multiorg`; `diagnostico_marca` repetido no duplica; negocio sin módulo → 404 en `/m/diagnostico`, `/api/m/diagnostico/*` y `/api/brains/tools/*` — validado por el dueño en staging (`eventos-test` con `diagnostico`, `clinica-test` → 404, `0033` y `0034` aplicadas)
- [x] T074 Merge `--no-ff` de 072-B a `main` en ambos repos (aprobado por el dueño, 2026-11-19); ROADMAP y `specs/README.md` → ✅

---

## Resumen de commits y pruebas

### Ronda 072-A (2026-11-19)

| Bloque | vocero-crm | nea-agent |
|---|---|---|
| Diseño | `3940c9a` | — |
| A0 Red de seguridad | `a18c114` | `e161372` |
| A1 Registro de packs + `0032_motor_nicho` | `80e548c` | — |
| A2 Menú, vocabulario e Inicio | `aec2132` | — |
| A3 Ficha flexible | `b04c4d5` | — |
| A4 `update_ficha` dinámico | — | `8886cfb` |
| A5 Plantillas en panel, Blueprint y MCP | `8d9d032` | — |
| A6 Personas por nicho | `2440bc5` | — |
| AZ Cierre (2.12.0, CHANGELOG, mapa, guion E2E) | commit de cierre | `b7bfe87` |

Gates locales al cierre:
- **vocero-crm**: `typecheck` 0 errores · `lint` limpio · Vitest
  `--maxWorkers=1 --no-file-parallelism` **171 archivos / 2 102 pruebas en verde**.
- **nea-agent**: `pytest` **874 passed, 40 skipped** (las 40 requieren Postgres;
  base antes de la 072: 830 passed, 40 skipped). Las 6 doradas B0
  (`test_el_prompt_no_cambia_ni_una_letra`) intactas.

Pruebas existentes cambiadas A PROPÓSITO (cada una por un cambio aprobado):
- `trato-071.test.ts`: la 0031 ya no es la última migración → se exige que
  esté en el journal (una vez).
- `nav.test.ts` y `red-072.test.ts`: Ajustes gana la entrada «Ficha» (T027).
- `plataforma-mcp.test.ts`: la lista exacta de herramientas suma
  `list_vertical_packs` y `get_vertical_pack` (solo lectura).
- Manifiestos (`docker-compose.yml`, `render.yaml`, `fly.toml`,
  `railway.toml`, README): imagen fijada a 2.12.0 (bump de versión).

Desviaciones del plan: sin tema `fiesta` (T020); Ajustes → Ficha sin
soporte de configuración (T026); overrides sin UI propia (T038); extensión del
arnés `e2e-plataforma.mjs` pendiente para staging (T046).

## Auditoría 072-A (`AUDITORIA-072A.md`) — remediada

Aplicadas A-1..A-8, M-1..M-10 y B-1..B-5 en la misma rama, sin cambio de
versión (2.12.0 aún no se publica). Decisiones del dueño: Ajustes → Ficha sigue
fuera del soporte de configuración (solo M-8: el `puedeEditar` del GET = el
PUT) y los packs siguen con temas existentes + acento propio.

Regresiones: `tests/unit/auditoria-072a.test.ts`,
`tests/unit/auditoria-072a-contacto.test.ts` (PATCH con `ignored`) y, en Nea,
`tests/test_ficha_dinamica_072.py` (A-8, M-6, M-9, B-5).

Gates: vocero-crm `typecheck` 0 · `lint` limpio · Vitest **173 archivos /
2 169 pruebas en verde** · nea-agent `pytest` **888 passed, 40 skipped**; las 6
doradas B0 intactas.

Pruebas cambiadas A PROPÓSITO: `ficha-072.test.ts` (quitar todos los campos
deja la memoria de tipos retirados, A-4; opciones una por línea, B-1; la ruta
usa `puedeEditarFicha`, M-8), `personas-072.test.ts` (rangos 11xx/12xx, A-1),
`inicio-072.test.ts` (`/inbox` en `ocultas` ahora invalida los ajustes, M-3) y
el dorado de Nea `072_cloud_con_ficha.txt` (etiquetas como lista JSON, M-9).

### Ronda 072-B — B1 a B3 (2026-11-19, rama `feat/072b-puente-herramientas`)

| Bloque | vocero-crm | nea-agent |
|---|---|---|
| B1 Marco de módulos | `d86d52b` | — |
| B2 Puente en el CRM + `0033_llamadas_de_herramienta` | `ce6a4f4` | — |
| B3 Puente en Nea | — | `ad4092c` |

Gates locales:
- **vocero-crm**: `typecheck` 0 errores · `lint` limpio · Vitest
  `--maxWorkers=1 --no-file-parallelism` **176 archivos / 2 216 pruebas en verde**.
- **nea-agent**: `pytest` **931 passed, 40 skipped** (las 40 requieren
  Postgres). Las 6 doradas B0 intactas.

Pruebas existentes cambiadas A PROPÓSITO:
- `verticals-072.test.ts`: `EXPERIENCIA_DEFAULT` gana `modulos` (vacío).
- `cerebros-070-aislamiento.test.ts`: la matriz A↛B suma `tools/[name]`, y
  el mock de módulos enciende `diagnostico` para que esa ruta llegue a
  buscar la conversación (en A).
- `brains-rutas-tipos-next.test.ts`: suma la ruta dinámica `tools/[name]`.

## Auditoría 072-B (`AUDITORIA-072B.md`) — remediada

Aplicadas A-1..A-3, M-1..M-3 y B-1..B-4 en `feat/072b-puente-herramientas`,
con la preparación de 2.13.0 (T071). `0033` ya corría en staging: el índice
`brain_tool_call_conv_idx` (M-1) y el `CHECK brain_tool_call_hecha_ck` (B-3)
van en la migración aditiva `0034_llamadas_indices`.

Gates locales:
- **vocero-crm**: `typecheck` 0 errores · `lint` limpio · Vitest
  `--maxWorkers=1 --no-file-parallelism` **177 archivos / 2 230 pruebas en verde**.
- **nea-agent**: `pytest` **939 passed, 40 skipped** (las 40 requieren
  Postgres). Las 6 doradas B0 intactas.

Pruebas existentes cambiadas A PROPÓSITO:
- `brains-tools.test.ts`: `ejecutarLlamada` recibe el ámbito (organización
  y despliegue); `claveIdempotencia` suma la conversación; `resultado_grande`
  trae `detalle`; la retención se prueba por lotes (`execute`).
- `test_herramientas_dinamicas_072.py`: sin despacho, `call_tool` ya no
  inventa un id: no llama al CRM.

Cierre (2026-11-19): smoke de staging en verde; el formulario de
`/platform` conserva y muestra `modules.modules` (antes los descartaba al
guardar; prueba en `formulario-blueprint.test.ts`). Merge `--no-ff` a `main`
de ambos repos.
