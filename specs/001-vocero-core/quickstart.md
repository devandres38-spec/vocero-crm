# Quickstart — desarrollo local y self-test (001-vocero-core)

## Requisitos

Node 22 + pnpm · Docker (para Postgres local y la Ruta B) · `.env` a partir de
`.env.example`.

## Levantar en desarrollo

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d postgres   # Postgres local
pnpm db:migrate                                            # aplicar migraciones
pnpm dev                                                   # http://localhost:3000
```

Primer uso (074, sin registro público): crea el negocio y su dueño con
`pnpm negocio:alta -- --nombre "Mi negocio" --dueno-correo tu@correo.co --dueno-nombre "Tu nombre"`
(muestra la contraseña una sola vez), entra con ese correo → botón "Cargar datos de
demostración" (o `pnpm seed:demo -- --organizacion <id>`).

Los arneses `scripts/e2e-*.mjs` que no corren en `e2e.yml` se registraban en una
instalación vacía: ahora necesitan el operador creado antes, con
`node --env-file=.env scripts/e2e-operador.mjs` (el de `e2e@vocero.test`) o con
`pnpm negocio:alta` y su propio correo.

## Modo de pruebas interno (self-test)

En `.env` de desarrollo:

```
WA_MOCK_ENABLED=true
META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph
OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock
OPENROUTER_API_TOKEN=test-token
```

Conectar el número en Settings → WhatsApp con IDs de prueba (cualquier token SIN el
sufijo `-invalid`). Simular un entrante:

```bash
curl -X POST localhost:3000/api/dev/wa-mock/inbound \
  -H 'content-type: application/json' \
  -d '{"phoneNumberId":"<el del wizard>","from":"5215511111111","name":"Cliente Demo","text":"hola"}'
```

## Gate técnico y tests

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test   # Vitest unit
```

Self-test E2E: se conduce con Playwright (MCP) siguiendo los guiones de
`tests/e2e/` contra `pnpm dev` y contra la Ruta B (`docker compose up`).

## Ruta B local (verificación compose)

```bash
DOMAIN=localhost docker compose up -d --build
# Caddy sirve https://localhost (cert interno); healthchecks en app/db/caddy
```
