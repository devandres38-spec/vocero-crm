# 070 — Tareas (bloque C)

Un bloque: dos PRs (`vocero-crm` y `aliantis-brain`) y `estado.md` y `decisiones.md` en `aliantis-core`, revisados y unidos juntos.

- [x] T1 Spec y estas tareas.
- [x] T2 Migración `0029`: `consent`, `message.button_id` y `buttons`, `privacy_profile.adjuntos`, `olvido_pendiente`; prefijo `cns_`. `pnpm db:generate` sin diferencias.
- [x] T3 Filtro de ubicación, contactos y nombre de archivo (`adjuntos.ts`, `webhook.ts`, segunda red en la ingesta); prueba con salud en cada campo.
- [x] T4 Adjuntos por negocio: `perfilVigente.adjuntos`, `attachMediaAsset`, `privacidad:sembrar --adjuntos`; prueba. Sabotaje 4.
- [x] T5 Botones: esquema de `messages`, `canal_sin_botones`, `sendText` con `interactive`, Laboratorio, `button_id` en la ingesta, `buttonId` en el despacho (gemelo intacto), chips en el hilo; pruebas.
- [x] T6 `POST /api/bot/consent` y `consent` en el contexto; escaneo de solo agregar. Sabotaje 3.
- [x] T7 `POST /api/bot/forget` (`olvidar.ts`, `borrarEventosDeWebhook`, ficha); pruebas. Sabotajes 1 y 2.
- [x] T8 `olvido_pendiente`: la ruta de eliminar y el reintento en el worker; pruebas de reloj.
- [x] T9 Cerebro: `olvidarConversacion` con `conservarPendientes` y el cierre tras «No acepto» en `process-turn.ts`; pruebas.
- [x] T10 `e2e-consentimiento.mjs` y su guion, en `e2e.yml`.
- [x] T11 `docs/openapi.json`, `AGENTS.md`, enmienda del contrato del despacho, `estado.md` y `decisiones.md`. CI y `e2e.yml` en verde.
