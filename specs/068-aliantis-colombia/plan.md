# Implementation Plan: Marca Blanca Aliantis + Localización Colombia

**Branch**: `068-aliantis-colombia` | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)
**Estado**: borrador para aprobación — no se ha cambiado código.

## Summary

Centralizar la localización en `src/lib/region.ts` con defaults de instancia
Colombia (CO, `es-CO`, COP, `America/Bogota`) configurables por entorno; mostrar
COP sin decimales manteniendo centavos; reemplazar la marca por defecto por
Aliantis (logo "A" chevron, acento `#0D3B9E`) y quitar "Vocero" de todo texto
visible sin tocar identificadores técnicos; cambiar el default de zona en la
base (migración `0027`) y en Nea; normalizar teléfonos de entrada humana con
`libphonenumber-js`; y adaptar Laboratorio y demo a Colombia, corrigiendo de
paso el borrado sin `organization_id` de la demo.

## Technical Context

**Language/Version**: TypeScript 5.9 (Next.js 15, React 19) · Python 3.11/3.12 (Nea)
**Primary Dependencies**: Drizzle ORM, Zod, Vitest · FastAPI, pytest · **nueva**: `libphonenumber-js` (MIT, embebida, metadatos `min`)
**Storage**: PostgreSQL 16 — migración aditiva `0027` (solo `ALTER COLUMN … SET DEFAULT`)
**Testing**: Vitest (`--maxWorkers=1 --no-file-parallelism` local) · pytest · E2E en CI/staging
**Target Platform**: contenedor Linux (VPS) · navegadores modernos (Intl con datos `es-CO`)
**Constraints**: equipo local de gama baja (sin `next build`, Docker ni Playwright local); contratos `x-vocero-*` / `vocero:cerebro:v1` intactos
**Scale/Scope**: ~45 archivos de `src/`, 5 de Nea, ~20 pruebas unitarias afectadas

## Constitution Check

| # | Gate | Estado |
|---|---|---|
| I | Sin secretos nuevos. **Corrige** un cruce: `seedDemo` borra contactos por teléfono sin filtrar organización → se filtra por `organization_id`, con prueba de cruce | ✅ |
| II | `libphonenumber-js`: librería embebida sin red, MIT, ~80 KB con metadatos `min` → admisible (Principio II, librería embebida). Sin servicios nuevos | ✅ (justificada) |
| III | Defaults de instancia; moneda y zona siguen por organización; nada cableado a una organización | ✅ |
| IV | Sin eventos externos nuevos; la semilla sigue re-ejecutable | ✅ |
| V | Local: typecheck, lint, Vitest acotado, pytest. CI/staging: build + E2E | ✅ |
| VI | Ciclo completo (migración + dependencia) | ✅ |
| VII | Decisiones D1–D8 abajo; supuestos visibles | ✅ |
| VIII | Sirve a atender/convertir (dinero, horas, teléfonos correctos) | ✅ |
| IX | E2E de marca, monto, importación y agenda en CI/staging | ✅ (pendiente CI) |
| X | Sin lógica de nicho; contratos con el cerebro sin cambios (pruebas gemelas intactas) | ✅ |
| XI | Es la feature que aplica XI: un módulo de región + guardarraíles | ✅ |
| Modo | Igual en `single` y `multi` | ✅ |

Re-check tras Fase 1: sin violaciones nuevas.

## Decisiones de diseño

**D1 — Región de instancia por entorno; por organización solo moneda y zona.**
`src/lib/region.ts` exporta `REGION_DEFAULTS = { country: "CO", locale: "es-CO",
currency: "COP", timezone: "America/Bogota" }` y `getRegion()` (servidor) que lee
`REGION_COUNTRY/LOCALE/CURRENCY/TIMEZONE` validadas en `src/lib/env.ts` (zod
opcional, inválido → default + aviso en `pnpm doctor`). La moneda por
organización sigue en Marca y la zona en Agenda (ya existen). Locale y país por
organización llegan en 069.

**D2 — El locale llega al cliente por contexto, no por `NEXT_PUBLIC_*`.**
Las variables de la plataforma son de runtime (no de build). `(app)/layout.tsx`
y `(auth)/layout.tsx` leen `getRegion()` y montan `<RegionProvider value=…>`;
los componentes usan `useRegion()` y helpers puros de `src/lib/region.ts`
(`formatDate`, `formatTime`, `formatDateTime`, `formatNumber`) que reciben el
locale. Código de servidor usa `getRegion()` directamente.

**D3 — Decimales de pantalla por moneda.** `money.ts` agrega
`DISPLAY_FRACTION_DIGITS = { COP: 0, CLP: 0, PYG: 0 }` (resto 2) y
`formatMoneyCents(cents, currency, locale)` usa esos dígitos (redondeo de Intl).
`COP` se agrega a la cabeza del catálogo; `DEFAULT_CURRENCY` pasa a salir de la
región. `parseMoneyToCents` no cambia (ya interpreta `150.000` como miles y
`1.234,56` con coma decimal; se agregan casos de prueba colombianos).
Resultado en `es-CO`: `$ 150.000` (Intl usa espacio duro tras el símbolo).

**D4 — Teléfonos: `src/lib/phone.ts` solo para entrada humana.**
`normalizarTelefonoHumano(raw, paisDefecto)`:
1. Limpia; si empieza con `+` o `00`, o sus dígitos parsean como internacional
   **posible** → número de su país.
2. Si no, parsea con `paisDefecto` y exige `isValid()` (no solo longitud: evita
   pegarle 57 a un `55…` mexicano).
3. Devuelve dígitos E.164 sin `+`, pasados por `normalizeMx` (canonización
   `521→52`, que sigue en `lib/meta/client.ts`).
Lo usan `normalizeImportPhone` (`lib/contact-import.ts`), `POST /api/contacts`
y los diálogos (vista previa). `inbox/identity.ts` e `ingest.ts` **no cambian**
(FR-009). Se importa `libphonenumber-js/min`.

**D5 — Marca Aliantis en el módulo de marca.**
- `src/lib/brand.ts`: `PLATFORM_BRAND_NAME = "Aliantis"`,
  `BRAND_MARK_LEFT = "M4 20 L12 4"`, `BRAND_MARK_RIGHT = "M12 4 L20 20"`
  (trazo redondeado, `stroke-linecap: round`), `BRAND_TEAL = "#10C4A5"`;
  `isVoceroName` → `isPlatformBrandName(name)`.
- `brand-mark.tsx`, `favicon.ts` (`platformFaviconSvg`), `server/app-icon.tsx`
  dibujan la "A": pierna izquierda `currentColor` (blanco sobre el mosaico),
  derecha `#10C4A5`.
- `lib/branding.ts`: `DEFAULT_BRANDING = { name: "Aliantis", accent: "#0D3B9E",
  currency: región, favicon: null }`; primer preset "Azul Aliantis" con su set
  derivado (hover/soft/tint/text/fg calculados con la derivación existente de
  `lib/branding.ts` —la que usa `resolveAccentSet` para un color propio— y
  fijados en la prueba). `globals.css` `--accent*` a los valores del set.
- `lib/temas.ts`: claves `vocero`/`vocero-oscuro` se conservan (son datos
  guardados por persona); `nombre` → "Aliantis" / "Aliantis oscuro".

**D6 — Textos "Vocero" visibles → neutros o con la marca.** Los ~20 textos se
reescriben sin nombre de producto ("Este CRM no trae agente…", "Mueve y cancela
desde aquí…") o con `branding.name` donde ya está a mano. Guardarraíl
`tests/unit/marca-sin-vocero.test.ts`: escanea strings/JSX de `src/app` y
`src/components` (+ `src/server/onboarding/guide.ts`), ignora comentarios, con
lista blanca técnica (`x-vocero-`, `vocero:cerebro`, `VOCERO_`, `/vocero/`,
claves de tema).

**D7 — Zona: migración `0027` + defaults en código.** `schema.ts`:
`.default("America/Bogota")`; `pnpm db:generate` produce
`drizzle/0027_zona_bogota.sql` (`ALTER TABLE "calendar_settings" ALTER COLUMN
"timezone" SET DEFAULT 'America/Bogota';`). No toca filas existentes.
`agenda/settings.ts` `DEFAULT_TIMEZONE` = `getRegion().timezone`;
`analytics/period.ts` lo hereda. Placeholder de `agenda-client.tsx` desde región.
Guardarraíl de literales regionales (`tests/unit/region-sin-literales.test.ts`).

**D8 — Nea.** `DEFAULT_TZ = ZoneInfo("America/Bogota")` (`prompt.py`);
`agent_timezone = "America/Bogota"` (`config.py`); fallbacks de `tools.py` y
`turn.py`; `.env.example`. `canonical_identity` (521) no cambia. Pruebas: las
que fijan `America/Mexico_City` explícitamente siguen válidas; se ajustan solo
las que dependían del default (revisar `test_zona_del_negocio.py`,
`test_cloud_mode.py`, `test_ensayo.py`, `test_citas_en_contexto.py`).

## Project Structure

### Documentation (this feature)

```text
specs/068-aliantis-colombia/
├── spec.md
├── plan.md      # este archivo
└── tasks.md
```

No se generan `research.md`, `data-model.md` ni `contracts/`: no hay contrato
nuevo ni cambio de forma de datos (solo un default de columna, descrito en D7).

### Source Code (archivos tocados)

```text
vocero-crm/
├── package.json · pnpm-lock.yaml          # + libphonenumber-js; versión 2.8.0
├── .env.example                            # REGION_* con guía inline
├── drizzle/0027_zona_bogota.sql            # generado + meta/
├── src/lib/
│   ├── region.ts                 (nuevo)   # defaults, getRegion, formatters
│   ├── region-context.tsx        (nuevo)   # RegionProvider / useRegion
│   ├── phone.ts                  (nuevo)   # normalizarTelefonoHumano
│   ├── env.ts                              # REGION_* opcionales
│   ├── money.ts                            # COP, decimales de pantalla, locale
│   ├── brand.ts · branding.ts · favicon.ts · temas.ts · contact-import.ts
│   ├── time/slots.ts                       # locale por parámetro
│   └── db/schema.ts                        # default de zona
├── src/app/(app)/layout.tsx · (auth)/layout.tsx · globals.css
├── src/app/api/contacts/route.ts · conversations/[id]/route.ts · dev/wa-mock/…
├── src/components/                         # ~15 componentes (fechas, textos, logo)
├── src/server/
│   ├── agenda/settings.ts · channels/capabilities.ts · app-icon.tsx
│   ├── onboarding/guide.ts · lab/personas.ts · seed/demo.ts
│   └── doctor/checks.ts                    # aviso REGION_* inválidas
└── tests/unit/                             # nuevas + ajustadas
nea-agent/
├── app/prompt.py · config.py · tools.py · turn.py
├── .env.example
└── tests/                                  # solo las que dependían del default
```

## Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Instancia existente sin moneda guardada pasa a mostrar COP | Nota en `CHANGELOG` («Actualizar desde 2.7»): fijar `REGION_CURRENCY=MXN` para conservar |
| `contraste-temas.test.ts` falla con el nuevo acento | El set de `#0D3B9E` se deriva con la función existente y se valida AA antes de fijarlo |
| Datos ICU `es-CO` ausentes en el runtime | Node 20+ trae ICU completo; el respaldo de `formatMoneyCents` evita romper la pantalla |
| Peso del bundle por `libphonenumber-js` | Metadatos `min` e import solo en diálogos de contactos |
| Pruebas que fijan textos "Vocero" o `#0d5bff` | Se actualizan en la misma tarea que cambia el texto/valor |

## Complexity Tracking

Sin violaciones que justificar.
