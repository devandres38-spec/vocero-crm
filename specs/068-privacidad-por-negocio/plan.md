# 068 — Plan

Spec: [spec.md](spec.md). Modelo: [data-model.md](data-model.md). Contratos: [contracts/perfil-privacidad.md](contracts/perfil-privacidad.md) y [contracts/vectores-gemelos.md](contracts/vectores-gemelos.md).

## Constitution Check (antes del diseño)

| Principio | Cumple | Cómo |
| --- | --- | --- |
| I. Seguridad | Sí | El perfil no es secreto, pero tampoco se imprime: los comandos muestran perfil, versión y huella, nunca los términos. Ningún log lleva texto de un paciente |
| II. Soberanía | Sí | Sin terceros. `libphonenumber-js` es una librería (MIT) que corre dentro del proceso, sin red |
| III. Multi-tenancy | Sí | `privacy_profile.organization_id` NOT NULL, único, `on delete cascade`; la lectura va con `scoped()` |
| IV. Idempotencia | Sí | Registrar el mismo archivo dos veces deja la misma fila; la migración es aditiva |
| V y IX. Verificación | Sí | Vectores gemelos, pruebas unitarias, sabotajes (abajo). Sin comportamiento observable nuevo: no hace falta guion E2E (FR-009) |
| VI. Specs antes de código | Sí | Ciclo completo: toca el modelo de datos y un formato compartido entre repos |
| VII. Trazabilidad | Sí | Origen de cada archivo copiado en su encabezado (commit del cerebro); decisión D1 de Aliantis |
| VIII. Foco vertical | Sí | Es la privacidad del canal de WhatsApp |

## Divergencias (gana Aliantis Core, documentadas)

1. **Nombres en inglés en `src/server/privacy/`.** Vocero nombra en español lo nuevo; estos archivos conservan los nombres del cerebro (`classifyAndMask`, `PrivacyPolicy`…) para que comparar los dos lados sea leer, no traducir. Lo nuevo de Vocero alrededor (`perfilDePrivacidad`, `sembrarPerfil`) va en español.
2. **El rol del negocio no administra su perfil de privacidad.** En Vocero cada negocio configura todo lo suyo desde Ajustes; aquí no. Pilar 1 (alta solo por Andres) y pilar 4 (el filtro no se apaga por accidente).

## Fase 0 — Lo investigado en el código

- **El filtro del cerebro** (`aliantis-brain/src/privacy/`, 217 líneas, trasplantado tal cual de `aliantis-core` en el paso 2.1; huellas en `TRASPLANTE.md`): `classifyAndMask(text, policy)` omite el texto entero si encuentra un término de salud (salvo dentro de una frase permitida, las más largas primero) y si no, enmascara correo → tarjeta → teléfono → documento, en ese orden. `withoutReview` y `privacyFlagsOf` dan las marcas que el contrato 067 ya fija (`despacho-v2.md`, `privacyFlags`).
- **La política del cerebro** sale de `privacyPolicyFor(config)`: `terms = config.perfil.sensible` (las listas de `perfiles/listas/*.yaml` ya unidas al sembrar; `null` si el perfil dice `sensible: ninguno`), `allowlist` = nombres y sinónimos de los servicios, `country = config.negocio.pais` (CO por defecto).
- **Huella:** el cerebro ya tiene `canonicalJson` y `profileHash` en `src/config/client-config.ts`; la huella del perfil de privacidad usa el mismo `canonicalJson` (claves ordenadas, sin espacios).
- **Corpus:** `aliantis-brain/test/unit/privacy-corpus.test.ts` (mensajes reales con y sin salud) y los casos de `privacy-filter.test.ts` son la base de los vectores.
- **Vocero:** sin filtro ni `libphonenumber-js` (normaliza teléfonos mexicanos a mano en `src/lib/meta/client.ts`, que no se toca). Las tablas de ajustes por negocio siguen un patrón (`agent_profile`, `capi_settings`: `id` con prefijo, `organization_id` único con cascada, `created_at`/`updated_at`). Las pruebas unitarias simulan la base (`vi.mock("@/lib/db")`); no hay pruebas contra PostgreSQL. Los comandos de mantenimiento se empaquetan con esbuild (`seed:demo`).
- **Migraciones:** la última es `0026_cuenta_de_mensajes`. La `0027` que reservaba la spec 067 (`consent` y columnas de `message`) no se ha escrito; esta toma la `0027` y la de 067 pasa a la `0028` (se corrige en `067/data-model.md` en este mismo PR).

## Fase 1 — Diseño

### El módulo (`src/server/privacy/`)

| Archivo | Origen | Cambio |
| --- | --- | --- |
| `normalize-text.ts` | `aliantis-brain/src/privacy/normalize-text.ts` | Solo formato |
| `health-terms.ts` | `…/health-terms.ts` | Formato e importaciones |
| `privacy-filter.ts` | `…/privacy-filter.ts` | Formato, importaciones y sin `privacyPolicyFor` (depende de `ClientConfig`) |
| `perfil.ts` | Nuevo | Esquema zod del contrato, `canonicalJson`, `huellaDePerfil`, `politicaDesdePerfil` |
| `repositorio.ts` | Nuevo | `perfilDePrivacidad(organizationId)` y `guardarPerfil(...)`, con `scoped()` |

Cada archivo copiado lleva en su encabezado el commit del cerebro del que salió. El esquema zod repite las reglas de `profile.ts` del cerebro: términos normalizados (`isNormalizedTerm`), las cuatro categorías exactas, objeto estricto.

### Leer el perfil (D3)

`perfilDePrivacidad(organizationId): Promise<PrivacyPolicy | null>`:

1. una consulta con `scoped(organizationId)`;
2. sin fila → `null`;
3. valida la fila con el esquema y recalcula la huella; si algo no cuadra → `null` y `log.error({ organizationId, motivo })`, sin contenido;
4. devuelve `{ terms, allowlist, country }`.

Sin caché en este paso: es una consulta por ingesta, sobre un índice único. Se mide en 3.2 y se decide ahí.

### Registrar el perfil (D2, D4, D5)

`scripts/privacidad-sembrar.ts` → `pnpm privacidad:sembrar -- --organizacion <id> [--sin-filtro-salud] <archivo.json>`:

1. lee y valida el archivo con el esquema (estricto);
2. recalcula la huella y la compara con `huella` del archivo;
3. `sensible: null` sin `--sin-filtro-salud` → rechaza;
4. comprueba que la organización existe;
5. inserta o reemplaza (`on conflict (organization_id) do update`);
6. imprime perfil, versión, huella anterior (si había) y nueva. Sale distinto de cero en cualquier rechazo, sin tocar la base.

La lógica vive en `src/server/privacy/sembrar.ts` (probada con la base simulada); el script solo lee argumentos y el archivo.

### Del lado del cerebro

- `src/privacy/perfil-exportado.ts`: `perfilExportado(config)` arma el JSON del contrato desde `privacyPolicyFor(config)`, con `perfil` y `versionPerfil` de la configuración y la huella. Archivo nuevo del cerebro, no trasplantado: no entra en `TRASPLANTE.md`.
- `scripts/exportar-privacidad.ts` → `npm run privacidad:exportar -- <cliente.yaml>`: lee con `readClientYaml` (lo mismo que `cliente:sembrar`), escribe el JSON en la salida estándar y la huella en la de errores.
- `scripts/generar-vectores-privacidad.ts` → `npm run privacidad:vectores`: arma los vectores con los casos y perfiles de `contracts/vectores-gemelos.md` y escribe `test/fixtures/privacidad-vectores.json`.
- `test/unit/privacidad-gemela.test.ts`: la prueba gemela del lado del cerebro.

### La prueba gemela (D7, D8)

En cada repo, `privacidad-gemela.test.ts`:

1. la huella SHA-256 del archivo de vectores es la constante fijada en la prueba (la misma en los dos repos);
2. la versión instalada de `libphonenumber-js` es la del archivo;
3. cada perfil del archivo pasa el esquema y su huella cuadra;
4. cada caso, con su perfil, da exactamente `esperado` (`text`, `health`, `masked`, `flags`).

En Vocero vive en `tests/unit/privacidad-gemela.test.ts` con el archivo en `tests/unit/fixtures/privacidad-vectores.json`. Cambiar el filtro del cerebro obliga a regenerar los vectores, copiar el archivo a Vocero y actualizar la constante en los dos: es a propósito.

### La demo

`scripts/seed/perfil-privacidad-demo.json` = `npm run privacidad:exportar -- clientes/demo/cliente.yaml`. `scripts/seed/demo.ts` lo registra con `guardarPerfil` para la organización de demo.

### Que no llegue al navegador

Un escaneo en las pruebas: ningún archivo con `"use client"` ni bajo `src/components/` importa `@/server/privacy`.

## Pruebas

| Prueba | Qué fija |
| --- | --- |
| `privacidad-gemela.test.ts` (los dos repos) | El mismo resultado, caso por caso (historia 1) |
| `privacidad-corpus.test.ts` (Vocero) | 100 % de detección y como máximo 5 % de falsos positivos con el perfil de la demo dental (historia 1.3) |
| `privacidad-perfil.test.ts` | Esquema estricto, huella, `sensible: null` (historias 2 y 4) |
| `privacidad-repositorio.test.ts` | Sin fila, fila inválida o huella distinta → `null`; la consulta lleva la organización (historias 3 y 5) |
| `privacidad-sembrar.test.ts` | Rechazos sin tocar la base; reemplazo con huella anterior (historia 2) |
| `privacidad-frontera.test.ts` | El escaneo del navegador |
| `perfil-exportado.test.ts` (cerebro) | El JSON exportado de `clientes/demo`, `demo-barberia` y `demo-academia` pasa el contrato y su huella es estable |

## Sabotajes (método de `aliantis-core/docs/trabajo/procedimiento.md`)

Cada uno se aplica, se corre la revisión y se restaura. Uno no detectado se investiga.

| # | Repo | Sabotaje | Lo detecta |
| --- | --- | --- | --- |
| 1 | vocero | Quitar `normalize('NFKC')` en `normalizeForMatching` | gemela |
| 2 | vocero | Volver espacio los caracteres invisibles (`\p{Cf}`) en vez de borrarlos | gemela |
| 3 | vocero | No ordenar las frases permitidas por largo | gemela |
| 4 | vocero | Exigir 16 dígitos en la máscara de tarjeta | gemela |
| 5 | vocero | Enmascarar teléfono antes que tarjeta | gemela |
| 6 | vocero | `perfilDePrivacidad` devuelve un perfil con `terms: null` cuando no hay fila | repositorio |
| 7 | vocero | No recalcular la huella al leer | repositorio |
| 8 | vocero | Consultar sin la organización | repositorio |
| 9 | vocero | Esquema no estricto (acepta una clave de más o un término con tilde) | perfil |
| 10 | vocero | Registrar `sensible: null` sin la bandera | sembrar |
| 11 | vocero | Registrar sin comparar la huella | sembrar |
| 12 | vocero | Importar `@/server/privacy` desde un componente de cliente | frontera |
| 13 | ambos | Cambiar la versión de `libphonenumber-js` en un solo lado | gemela |
| 14 | cerebro | Exportar sin los sinónimos de los servicios | perfil exportado y gemela |
| 15 | cerebro | Cambiar una regla del filtro y regenerar los vectores solo en el cerebro | gemela de Vocero (huella del archivo) |

## Lo que no se hará

- Conectar el filtro a la ingesta, al webhook o al Laboratorio (3.2).
- Pantalla o API del perfil (D5; panel de Andres en 4.6).
- Adjuntos y retención por negocio (3.3, 3.9).
- Caché del perfil (se mide en 3.2).
- RLS (4.5).

## Constitution Check (después del diseño)

Sin cambios respecto al de antes del diseño. Un riesgo nuevo: el tamaño de `libphonenumber-js/max` en el empaquetado del servidor (unos cientos de KB). Se comprueba con `pnpm build` y no llega al navegador (sabotaje 12).
