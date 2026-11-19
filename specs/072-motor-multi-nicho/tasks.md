# Tasks: Motor Multi-Nicho (072)

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [contracts/](contracts/)
**Estado**: D1–D22 aprobadas (2026-11-19). Ronda 072-A en curso.

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

- [ ] T001 `[crm]` Instantánea de `appNavGroups` y `settingsSections` actuales (con/sin agenda, cada rol) en `src/lib/nav.test.ts`
- [ ] T002 `[crm]` Prueba de la raíz: sin pack → `/onboarding` | `/inbox` como hoy
- [ ] T003 `[crm]` Prueba de `PUT /api/brains/ficha` y `/api/bot/ficha` sin esquema: respuesta byte a byte
- [ ] T004 `[nea]` Confirmar dorados B0 (`tests/test_chasis_dorado.py`) en verde y añadir prueba de catálogo de herramientas sin `fichaSchema` = actual
- [ ] T005 `[local]` gates — commit «072 A0: red de seguridad»

## Bloque A1 — Modelo y registro de packs `[crm]` (D2, D3, D5, D21)

- [ ] T006 Migración `0032_motor_nicho` (plan §3) + columnas en `schema.ts`; re-ejecutable
- [ ] T007 `src/verticals/tipos.ts`, `extender.ts`, `registro.ts` (`PACKS as const satisfies`, `PackId`, `esPackId`)
- [ ] T008 [P] `src/verticals/default/pack.ts` (vacío = 2.11.0)
- [ ] T009 [P] `src/verticals/clinica-salud/pack.ts` (plan §4)
- [ ] T010 [P] `src/verticals/eventos-mobiliario/pack.ts` (plan §4)
- [ ] T011 `src/verticals/resolver.ts` + `verticalOverridesSchema` (zod `.strict()`, ≤4 KB)
- [ ] T012 `src/server/verticals/experiencia.ts` (`cache()`; pack desconocido → `default` + log)
- [ ] T013 Pruebas: semillas válidas contra `blueprintSchema`; herencia de un nivel; `src/verticals/**` sin imports prohibidos; overrides basura = ignorados
- [ ] T014 `[local]` gates — commit «072 A1: registro de Vertical Packs»

## Bloque A2 — Navegación, vocabulario e Inicio `[crm]` (D4, D6, D7, D8) · US2

- [ ] T015 `nav.ts`: `appNavGroups({..., experiencia})`, `ICONOS_NAV`, orden/ocultas; sin experiencia = instantánea T001
- [ ] T016 `src/verticals/vocabulario.ts` `t(exp, termino, n)`; aplicar en nav, `<h1>` y estado vacío de Bandeja, Pipeline, Contactos, Citas y título de `FichaPanel`
- [ ] T017 `(app)/layout.tsx` → `experienciaDe()` → `AppShell`/`AppNav` por prop (serializable)
- [ ] T018 `src/app/page.tsx`: `experiencia.inicio ? "/inicio" : "/inbox"` tras `guideFirst`
- [ ] T019 `(app)/inicio/page.tsx` + widgets del núcleo en `src/components/inicio/widgets/` (`sin_responder`, `leads_por_etapa`, `citas_de_hoy`, `proximos_por_fecha`, `accesos_rapidos`), cada uno con `Suspense` y límite de error; sin `inicio` en el pack → `notFound()`
- [ ] T020 [P] Tema `fiesta` en `TEMAS` (pasa las pruebas de contraste existentes)
- [ ] T021 Pruebas: nav por pack, vocabulario, widgets filtran por `organizationId` (A↛B), `citas_de_hoy` oculto sin agenda
- [ ] T022 `[local]` gates — commit «072 A2: navegación, vocabulario e Inicio por nicho»

## Bloque A3 — Ficha flexible en el CRM `[crm]` (D9, D10, D12) · US3

- [ ] T023 `src/server/ficha/esquema.ts`: `fichaFieldsSchema`, `aplicarEsquema()` (coerción `es-CO`, `ignored`), `faltantes()`
- [ ] T024 `upsertFicha` aplica el esquema; respuesta suma `ignored` solo si no está vacío (T003 sigue verde)
- [ ] T025 `fichaSchema` en `contextoDeConversacion` (sirve a `/api/bot/context` y `/api/brains/context`); OpenAPI `docs/openapi.json` y `docs/openapi-brains.json`
- [ ] T026 `GET/PUT /api/settings/ficha-fields` (rol que configura; clave y tipo inmutables; 409 `tipo_inmutable`)
- [ ] T027 Ajustes → Ficha (`settings/ficha`): editor, reordenar, vista previa, aviso al quitar campo con valores; entrada en `settingsSections`
- [ ] T028 `FichaPanel` con controles por tipo + «Otros datos»
- [ ] T029 Pruebas: coerción por tipo, `ignored`, claves fuera del esquema, quitar campo conserva valores, A↛B en ajustes
- [ ] T030 `[local]` gates — commit «072 A3: ficha flexible por negocio»

## Bloque A4 — Ficha dinámica en Nea `[nea]` (D11) · US4

- [ ] T031 `app/herramientas/ficha.py`: `esquema_de_ficha(context)` dinámico y defensivo; `builtin.py` lo usa
- [ ] T032 `faltantes(context)` (≤3, en orden) y línea «Datos por reunir» en `app/prompt.py` solo con faltantes
- [ ] T033 `_update_ficha` devuelve `ignorados` cuando el CRM los manda
- [ ] T034 Pruebas `test_ficha_dinamica_072.py`, `test_datos_por_reunir_072.py`; dorados nuevos `tests/fixtures/prompt/cloud_con_ficha.txt`; B0 intactos; prueba de tamaño (20 campos ≤ +900 tokens estimados)
- [ ] T035 `[local]` pytest — commit «072 A4: update_ficha según la ficha del negocio»

## Bloque A5 — Plantillas, Blueprint, panel y MCP `[crm]` (D20) · US1

- [ ] T036 Blueprint: secciones `vertical` y `fichaFields` (contrato blueprint-072) + `secciones/vertical.ts`, `secciones/ficha.ts` en `aplicar.ts`/`exportar.ts`
- [ ] T037 `/platform/nuevo`: «Empezar desde plantilla» (precarga del `FormularioBlueprint`) + pestaña «Nicho»
- [ ] T038 Ficha de negocio en `/platform/organizaciones/[id]`: cambiar pack, overrides, «Aplicar plantilla» con dry-run (`plan_blueprint`)
- [ ] T039 MCP `list_vertical_packs`, `get_vertical_pack`; `get_catalog` con `verticalPacks` y `fichaFields`; `docs/plataforma-mcp.md`
- [ ] T040 Pruebas: plantilla aplicada dos veces → `sin_cambios`; Blueprint de la 071 idéntico; cambiar pack no reaplica semilla; auditoría registra secciones
- [ ] T041 `[local]` gates — commit «072 A5: plantillas de nicho en plataforma, Blueprint y MCP»

## Bloque A6 — Personas por nicho `[crm]` (D19) · US5

- [ ] T042 `personas.ts`: universales + aportes del pack; `personasDe(experiencia)`; rangos de teléfono
- [ ] T043 Laboratorio usa `personasDe`; `default` = 8 actuales
- [ ] T044 Pruebas: sin choques de teléfono entre packs; `default` sin cambios
- [ ] T045 `[local]` gates — commit «072 A6: personas del Laboratorio por nicho»

## Bloque AZ — Cierre de 072-A

- [ ] T046 `[crm]` Versión 2.12.0, `CHANGELOG.md`, `AGENTS.md`/`CLAUDE.md` (mapa: `src/verticals/`), guion `tests/e2e/072-motor-multi-nicho.md` (parte A) y extensión de `scripts/e2e-plataforma.mjs`
- [ ] T047 `[nea]` `CHANGELOG.md`
- [ ] T048 `[CI]` build + Vitest completo + pytest con Postgres
- [ ] T049 `[staging]` Un negocio por pack: capturas de menú/Inicio/ficha; Laboratorio «evento corporativo» con juez (SC-3); `default` sin cambios
- [ ] T050 Merge `--no-ff` de 072-A a `main` en ambos repos (con aprobación)

---

# Ronda 072-B — Módulos y Puente de herramientas (2.13.0)

## Bloque B1 — Marco de módulos `[crm]` (D2, D16, D17)

- [ ] T051 `src/modulos/tipos.ts` (`defineModulo`, `ModuleTool`, `Efecto`), `registro.ts`, `registro-cliente.ts`; `CATALOGO_VERTICAL` derivado del registro
- [ ] T052 `src/server/modulos/guardas.ts`: `exigirModulo`, `withModulo`
- [ ] T053 Experiencia: aportes de módulos efectivos (nav, widgets, secciones de ficha) — `ContactPanel` monta secciones vía `registro-cliente`
- [ ] T054 Módulo `diagnostico` (oculto): `/m/diagnostico` (página mínima) con `layout.tsx` guardado
- [ ] T055 Pruebas-guardarraíl: carpetas `m/*` con guarda; `api/m/*` con `withModulo`; el núcleo no importa `src/modulos/*` fuera de los registros; prefijos de href/herramienta; A↛B en `/m/*`
- [ ] T056 `[local]` gates — commit «072 B1: marco de módulos aislados»

## Bloque B2 — Puente en el CRM `[crm]` (D13, D14, D18, D21)

- [ ] T057 Migración `0033_llamadas_de_herramienta` + tabla en `schema.ts`; purga >30 días en la retención
- [ ] T058 `src/server/brains/herramientas.ts`: `moduleToolsDe(orgId)` (JSON Schema con `z.toJSONSchema`, límites de tamaño/cantidad, reservados)
- [ ] T059 `moduleTools` en `contextoDelCerebro` (solo `brains`)
- [ ] T060 `POST /api/brains/tools/[name]` (plan §2.5, pasos 1–8) con `withBrain`
- [ ] T061 Herramientas `diagnostico_eco` (lectura) y `diagnostico_marca` (escritura: nota de sistema)
- [ ] T062 Pruebas `brains-tools.test.ts`: cada código del contrato, módulo apagado = inexistente, A↛B, idempotencia (repetición, en curso, fallida reintenta), timeout con `AbortSignal`, resultado >4 KB
- [ ] T063 `docs/openapi-brains.json` + `docs/plataforma-cerebro.md`
- [ ] T064 `[local]` gates — commit «072 B2: puente de herramientas de módulo en el CRM»

## Bloque B3 — Puente en Nea `[nea]` (D15)

- [ ] T065 `app/herramientas/dinamicas.py`: `validar(context)`, `RESERVADOS`, `registro_del_turno(caps)` (sin herramientas → misma instancia `REGISTRO`)
- [ ] T066 `tool_schemas`, `solo_encendidas`, `ToolRuntime.execute`/`_permitida` usan el registro del turno; claves `modulo:*` permitidas solo si vinieron en el contexto
- [ ] T067 `BrainsCrmClient.call_tool` + mapeo de errores (contrato brains-072 §4); `RUTAS` intacto
- [ ] T068 Línea única de herramientas propias en CONTEXTO ACTUAL (solo si hay)
- [ ] T069 Pruebas `test_herramientas_dinamicas_072.py`: colisión con nativa/reservada, patrón, tamaños, >8, registro por turno sin fuga entre dos organizaciones concurrentes, `CrmRechazo` en 401, 404/409/422/504; dorado nuevo `cloud_con_herramientas.txt`; B0 intactos
- [ ] T070 `[local]` pytest — commit «072 B3: herramientas de módulo en el cerebro»

## Bloque BZ — Cierre de 072-B

- [ ] T071 `[crm]` Versión 2.13.0, `CHANGELOG.md`, guion E2E parte B; `[nea]` `CHANGELOG.md`
- [ ] T072 `[CI]` build + Vitest + pytest con Postgres
- [ ] T073 `[staging]` SC-5: `diagnostico_eco` por Nea `multiorg`; `diagnostico_marca` repetido no duplica; negocio sin módulo → 404 en `/m/diagnostico`, `/api/m/diagnostico/*` y `/api/brains/tools/*`
- [ ] T074 Merge `--no-ff` de 072-B a `main` en ambos repos (con aprobación); ROADMAP y `specs/README.md` → ✅

---

## Resumen de commits y pruebas

_(se llena al implementar)_
