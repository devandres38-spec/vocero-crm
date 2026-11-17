# Tasks: Marca Blanca Aliantis + Localización Colombia

**Input**: [spec.md](spec.md) · [plan.md](plan.md)
**Estado**: implementada en `feat/068-aliantis-colombia` (vocero-crm y
nea-agent) el 2026-11-17. Verificación local en verde (typecheck, lint, Vitest
con un worker, pytest). Pendiente: `build` y E2E en CI/staging (T017, T022,
T029, T035, T040, T044) y, tras ellos, T045.

**Notas de implementación**
- La migración generada se renombró a `drizzle/0027_zona_bogota.sql` (solo
  `SET DEFAULT`).
- `normalizarTelefonoHumano` lee primero con código de país cuando hay 11
  dígitos o más (si no, «14155552671» se leía como colombiano) y canoniza
  `521→52` ANTES de parsear (libphonenumber ya no reconoce ese formato).
- Seguimiento sugerido para Nea (fuera de 068): su detector de relleno
  (`app/stall.py`) no conoce muletillas colombianas («listo», «dale», «de
  una»); la persona `sin_rumbo` usa «bueno», que sí reconoce.

**Formato**: `[ID] [P?] [Story] Descripción` · `[P]` = paralelizable (archivos
distintos, sin dependencia) · Verificación: `[local]` o `[CI/staging]`.

**Comandos locales** (equipo de gama baja):
- `npx pnpm@11.5.0 typecheck` · `npx pnpm@11.5.0 lint`
- `npx pnpm@11.5.0 exec vitest run --maxWorkers=1 --no-file-parallelism <archivos>`
- `pytest` en `nea-agent` (venv aparte)

---

## Phase 1: Setup

- [x] T001 Crear la rama `068-aliantis-colombia` en `vocero-crm` y en `nea-agent`
- [x] T002 Agregar `libphonenumber-js` a `vocero-crm/package.json` con `npx pnpm@11.5.0 add libphonenumber-js` y confirmar que `--frozen-lockfile` pasa `[local]`
- [x] T003 [P] Agregar `REGION_COUNTRY`, `REGION_LOCALE`, `REGION_CURRENCY`, `REGION_TIMEZONE` a `vocero-crm/.env.example` (comentadas, con default Colombia y guía inline)

## Phase 2: Foundational (bloquea las historias)

- [x] T004 Crear `src/lib/region.ts`: `REGION_DEFAULTS`, `getRegion()` y formatters puros (`formatDate`, `formatTime`, `formatDateTime`, `formatNumber`) que reciben `locale`
- [x] T005 Validar `REGION_*` en `src/lib/env.ts` (zod opcional; inválido → default) y avisar en `src/server/doctor/checks.ts`
- [x] T006 Crear `src/lib/region-context.tsx` (`RegionProvider`, `useRegion`) y montarlo en `src/app/(app)/layout.tsx` y `src/app/(auth)/layout.tsx`
- [x] T007 [P] Pruebas `tests/unit/region.test.ts`: defaults, override por entorno, valor inválido cae al default, formatters en `es-CO` `[local]`
- [x] T008 [P] Guardarraíl `tests/unit/region-sin-literales.test.ts`: falla si aparece `es-MX`, `es-CO`, `"MXN"`, `"COP"`, `America/Mexico_City` o `America/Bogota` en `src/` fuera de `lib/region.ts`, `lib/money.ts` (catálogo) y catálogos de selección; ignora comentarios. Se escribe primero y queda en rojo hasta US2/US3 `[local]`

**Checkpoint**: región disponible en servidor y cliente.

---

## Phase 3: User Story 1 — La instancia nueva ya es Aliantis (P1) 🎯 MVP

- [x] T009 [US1] `src/lib/brand.ts`: `PLATFORM_BRAND_NAME`, trazos de la "A" (`BRAND_MARK_LEFT`, `BRAND_MARK_RIGHT`), `BRAND_TEAL = "#10C4A5"`, `isPlatformBrandName()` en lugar de `isVoceroName()`
- [x] T010 [US1] `src/components/brand-mark.tsx`, `src/lib/favicon.ts` (`platformFaviconSvg`), `src/server/app-icon.tsx`: dibujar la "A" (izquierda `currentColor`/blanco, derecha `#10C4A5`); actualizar `src/app/(auth)/layout.tsx`
- [x] T011 [US1] `src/lib/branding.ts`: `DEFAULT_BRANDING` Aliantis `#0D3B9E`, preset "Azul Aliantis" con set derivado; `src/app/globals.css` `--accent*`
- [x] T012 [P] [US1] `src/lib/temas.ts`: `nombre` "Aliantis" / "Aliantis oscuro" (claves `vocero*` intactas)
- [x] T013 [US1] Reescribir los textos visibles con "Vocero": `onboarding/onboarding-client.tsx`, `server/onboarding/guide.ts`, `agent/brain-status-card.tsx`, `lab/lab-client.tsx`, `bookings/booking-drawer.tsx`, `activar-avisos.tsx`, `settings/{apariencia,branding,channels,instagram,messenger,tiktok}-client.tsx`, `settings/zernio-connect.tsx`, mocks de `api/dev/wa-mock/graph/[...path]/route.ts`
- [x] T014 [US1] Guardarraíl `tests/unit/marca-sin-vocero.test.ts` (strings/JSX de `src/app`, `src/components`, `server/onboarding`; lista blanca técnica) `[local]`
- [x] T015 [US1] Ajustar pruebas que fijan la marca anterior: `branding`, `favicon`, `pwa`, `temas`, `contraste-temas`, `onboarding-guide`, `avisos-de-mensajes`, `avisos-sistema`, `messenger`, `analytics`, `analytics-period`, `version` `[local]`
- [x] T016 [US1] Confirmar sin cambios: `despacho-contrato`, `olvido-contrato`, `openapi` `[local]`
- [ ] T017 [US1] E2E de marca (login, onboarding, bandeja, Ajustes: título "Aliantis — …", logo "A", sin "Vocero" en el DOM) `[CI/staging]` — **pendiente CI/staging**

**Checkpoint**: US1 verificable sola.

---

## Phase 4: User Story 2 — Dinero en COP (P1)

- [x] T018 [US2] `src/lib/money.ts`: COP primero en `CURRENCY_OPTIONS`, `DISPLAY_FRACTION_DIGITS`, `formatMoneyCents(cents, currency, locale)` con decimales por moneda, `DEFAULT_CURRENCY` desde la región
- [x] T019 [US2] Pasar el locale de `useRegion()` en `pipeline/{pipeline-client,amount-dialog,lead-drawer}.tsx`, `results/{sales,hygiene}-section.tsx`, `settings/branding-client.tsx`; quitar `useState("MXN")`
- [x] T020 [P] [US2] `tests/unit/money.test.ts`: `15000000` COP → `$ 150.000`; `123456` COP → `$ 1.235`; MXN/USD con 2 decimales; parseo de `150.000`, `$150.000`, `1.234,56` `[local]`
- [x] T021 [P] [US2] Revisar `analytics`, `capi-payload`, `conversions` (la CAPI sigue mandando la moneda del lead; sin cambio de forma) `[local]`
- [ ] T022 [US2] E2E de monto en el tablero y en Resultados (`e2e-monto-pipeline.mjs`, `e2e-resultados.mjs` a COP) `[CI/staging]` — **pendiente CI/staging**

---

## Phase 5: User Story 3 — Hora de Bogotá (P1)

- [x] T023 [US3] `src/lib/db/schema.ts` default `America/Bogota` → `npx pnpm@11.5.0 db:generate` → revisar `drizzle/0027_*.sql` (solo `SET DEFAULT`) `[local]`
- [x] T024 [US3] `src/server/agenda/settings.ts` (`DEFAULT_TIMEZONE` desde región), placeholder de `settings/agenda-client.tsx`
- [x] T025 [US3] Fechas y horas con locale de región: `lib/time/slots.ts` (locale por parámetro), `api/conversations/[id]/route.ts`, `server/channels/capabilities.ts`, `inbox/{helpers.ts,message-thread.tsx}`, `agent/agent-client.tsx`, `anuncio-origen.tsx`, `lab/lab-client.tsx`, `results/sales-section.tsx`, `settings/{channels-client,entregas-card}.tsx`
- [x] T026 [P] [US3] Pruebas: `slots`, `analytics-period` y las de agenda que dependían del default; T008 pasa a verde `[local]`
- [x] T027 [P] [US3] Nea: `app/prompt.py` (`DEFAULT_TZ`), `app/config.py`, `app/tools.py`, `app/turn.py`, `.env.example` → `America/Bogota`
- [x] T028 [US3] Nea: ajustar solo las pruebas que dependían del default; `pytest` en verde `[local]`
- [ ] T029 [US3] E2E de agenda con zona Bogotá (`e2e-calendario.mjs`) `[CI/staging]` — **pendiente CI/staging**

---

## Phase 6: User Story 4 — Teléfonos colombianos (P2)

- [x] T030 [US4] Crear `src/lib/phone.ts` (`normalizarTelefonoHumano`, D4) con `libphonenumber-js/min`
- [x] T031 [US4] Usarlo en `src/lib/contact-import.ts` (`normalizeImportPhone` con país de región; acepta 10 dígitos válidos en CO) y en `src/app/api/contacts/route.ts` (schema acepta formato humano; mensaje de ejemplo colombiano)
- [x] T032 [P] [US4] Textos de `contacts/new-contact-dialog.tsx` e `import-contacts-dialog.tsx` ("57 para Colombia; también puedes escribir el número local")
- [x] T033 [P] [US4] `tests/unit/phone.test.ts` + `contact-import.test.ts`: `3001234567`, `+57 300 123 4567`, `573001234567` → `573001234567`; `(604) 444 5566` → `576044445566`; `+52 1 55 1234 5678` → `525512345678`; `5512345678` → `sin_codigo_pais`; `12345` → inválido `[local]`
- [x] T034 [US4] Confirmar sin cambios `identity`, `meta-client`, `echoes` (FR-009) `[local]`
- [ ] T035 [US4] E2E de importación CSV (`e2e-importar.mjs`) `[CI/staging]` — **pendiente CI/staging**

---

## Phase 7: User Story 5 — Laboratorio y demo colombianos (P2)

- [x] T036 [US5] `src/server/lab/personas.ts`: teléfonos `57000000000N`, guiones colombianos; `errores_modismos` con "quiubo", "me regala", "de una", "parce" (clave intacta)
- [x] T037 [US5] `src/server/seed/demo.ts`: precios COP, nombres colombianos, teléfonos `5700000001NN`, KB y perfil en pesos colombianos (marcas DeWalt/Bosch/Black+Decker)
- [x] T038 [US5] `seedDemo`: limpieza filtrada por `organization_id` e incluyendo `LEGACY_DEMO_PHONES` (los `52156…` anteriores) — Principio I
- [x] T039 [P] [US5] Prueba de cruce: sembrar la demo en la organización B no borra contactos de A con los mismos teléfonos; `roles-como-datos`, `doctor`, `favicon`, `pwa` en verde `[local]`
- [ ] T040 [US5] E2E del Laboratorio con la persona de modismos y siembra de demo (`e2e-selftest.mjs`) `[CI/staging]` — **pendiente CI/staging**

---

## Phase 8: Polish & Release

- [x] T041 [P] Actualizar `AGENTS.md` (identidad: entrada humana con país por defecto; región en `lib/region.ts`) y `CLAUDE.md` (mapa: región, teléfono, marca)
- [x] T042 Subir versión a `2.8.0` en `package.json`, `docker-compose.yml`, `render.yaml`, `fly.toml`, `railway.toml`, `INSTALL-IA.md`; entrada en `CHANGELOG.md` con «Actualizar desde 2.7» (`REGION_CURRENCY=MXN` para conservar pesos mexicanos) `[local: version.test, manifests-plataformas.test]`
- [x] T043 Gate local completo: `typecheck`, `lint`, Vitest completo con `--maxWorkers=1 --no-file-parallelism`, `pytest` `[local]`
- [ ] T044 `build` + E2E (T017, T022, T029, T035, T040) en verde `[CI/staging]` — **pendiente CI/staging**
- [ ] T045 Marcar 068 como «Hecha» en `ROADMAP-ALIANTIS.md` y `specs/README.md` solo tras T044

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → historias.
- US1 (Phase 3) y US2 (Phase 4) son independientes entre sí tras Phase 2.
- US3 depende de T004–T006 (región); T027–T028 (Nea) son independientes del CRM.
- US4 depende de T002 (dependencia) y T004.
- US5 depende de US2 (precios COP) y US4 (formato de teléfonos sintéticos).
- Phase 8 al final; T045 solo con CI/staging en verde.

## Estrategia

1. MVP: Phases 1–3 (marca Aliantis) → verificación local → PR.
2. Incremental: US2 → US3 (CRM + Nea) → US4 → US5, una verificación local por historia.
3. Un solo PR por repo al cierre si se prefiere menos ruido en CI; cada
   historia queda en su propio commit.
