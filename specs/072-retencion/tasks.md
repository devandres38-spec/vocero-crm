# 072 — Tareas (bloque E)

Un commit por paso, cada uno con las pruebas de su módulo. PRs: `vocero-crm` (código y spec), `aliantis-brain` (retención del cerebro), `aliantis-core` (`decisiones.md` y `estado.md`). Un solo merge.

- [x] T1 Spec y estas tareas (aprobadas por Andres el 10-nov-2026).
- [x] T2 Migración `0031`: `privacy_profile.retencion_dias` (90, de 7 a 3650) e índice `message_org_created_idx`; `--retencion` en `privacidad:sembrar`; `pnpm db:generate` sin diferencias.
- [x] T2b (D8) `loss_note` por `filtrarTextoLibre` al escribir. Sabotaje 8.
- [x] T3 Retención de Vocero: `aplicarRetencion` con las ocho tablas de D3, tandas, candado por negocio, archivos después del commit y la llamada diaria desde el worker. Pruebas: dos negocios, corte exacto, idempotencia, Resultados igual, adjunto compartido y de anuncio, cita futura, contacto activo, sin perfil. Sabotajes 1 a 4.
- [x] T4 Retención del cerebro: migración `0006`, cola `retencion` a las 3:00 (Bogotá), D5 por negocio dentro de `withOrganization`. Pruebas unitarias y de integración. Sabotajes 5 a 7 (en el CI del cerebro).
- [x] T5 Ruta de desarrollo `/api/dev/retencion`, `e2e-retencion.mjs` y su guion, en `e2e.yml`.
- [x] T6 `AGENTS.md`, `docs/openapi.json`, `decisiones.md` y `estado.md`. CI de los dos repos y `e2e.yml` en verde.
