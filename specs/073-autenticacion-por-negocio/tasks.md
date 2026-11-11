# 073 — Tareas (bloque F)

Un commit por paso, cada uno con las pruebas de su módulo. PRs: `vocero-crm` (código y spec) y `aliantis-core` (`decisiones.md` y `estado.md`). El cerebro no cambia. Un solo merge.

- [x] T1 Spec y estas tareas (decisiones aprobadas por Andres el 10-nov-2026; se programa con su «sigue»).
- [x] T2 Migración `0032`: tabla `meta_app` por negocio y canal; `src/server/whatsapp/app-secret.ts`; `pnpm meta:secreto` con `--canal` (lee sin eco de la entrada estándar, valida 32 hex, cifra, muestra los últimos 4). `pnpm db:generate` sin diferencias. Sabotaje 1.
- [x] T3 (4.1) `credencialDerivada` con el vector gemelo; `requireBot` con las seis filas del contrato; presupuesto y «quién responde» por negocio; las 16 rutas migradas; guardarraíl de rutas; pruebas existentes ajustadas. Sabotajes 2 a 5.
- [x] T4 (4.2) Firma por negocio en los webhooks de WhatsApp, Instagram y Messenger, obligatoria en producción, cada canal con su secreto; Zernio con la misma regla; aviso en el registro por la llave cruda; `recibirEvento` con la organización resuelta; Ajustes → Webhook por negocio; el mock firma con el secreto del negocio. Sabotajes 6 a 9.
- [x] T5 Cerebro falso y arneses con la credencial derivada; `e2e-multinegocio.mjs` y su guion, en `e2e.yml`.
- [x] T6 `docs/openapi.json`, `AGENTS.md`, `.env.example`, `decisiones.md` y `estado.md`. CI y `e2e.yml` en verde.
