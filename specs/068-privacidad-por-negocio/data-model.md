# 068 — Modelo de datos

Una migración aditiva, `0027_perfil_privacidad.sql`, generada con `pnpm db:generate` desde `src/lib/db/schema.ts`. Se aplica al arrancar, sin pasos manuales. No toca filas existentes.

> La spec 067 reservaba la `0027` para `consent` y las columnas de `message`; esa pasa a la `0028` (corregido en `../067-contrato-aliantis/data-model.md`).

## Tabla nueva: `privacy_profile`

| Columna | Tipo | Nota |
| --- | --- | --- |
| `id` | `text` PK | prefijo `prv_` (nuevo en `src/lib/db/ids.ts`) |
| `organization_id` | `text` NOT NULL | FK a `organization`, `on delete cascade`; **único**: un perfil por negocio |
| `profile_name` | `text` NOT NULL | El tipo de negocio del cerebro (`odontologia`, `generico`…). Solo informativo |
| `profile_version` | `integer` NOT NULL | La `version` de ese perfil en el cerebro. Solo informativo |
| `country` | `text` NOT NULL | ISO 3166-1 alfa-2 (`CO`, `MX`, `US`…), con `check (char_length(country) = 2)` |
| `sensitive_terms` | `jsonb` NULL | `{ urgencia, sintoma, condicion, medicamento }` con listas de términos. **`NULL` = filtro de salud apagado** (solo con `--sin-filtro-salud`) |
| `allowlist` | `text[]` NOT NULL default `'{}'` | Nombres y sinónimos de los servicios, en el orden en que los exporta el cerebro |
| `fingerprint` | `text` NOT NULL | SHA-256 hex de `canonicalJson({ pais, permitidos, sensible })` |
| `created_at` | `timestamp` NOT NULL default now | UTC |
| `updated_at` | `timestamp` NOT NULL default now | UTC; cambia al reemplazar |

- Índice único: `privacy_profile_org_uq` sobre `organization_id`.
- Ningún código del negocio la escribe: solo `guardarPerfil` (`src/server/privacy/repositorio.ts`), que usan el comando de Andres y la siembra de demo.
- Que no exista fila para un negocio **no** es un estado válido para guardar texto: en 3.2 se trata como «sin configuración legible» (D3).

## Sin cambios

- `message`, `webhook_event`, `dispatch`: los toca el paso 3.2.
