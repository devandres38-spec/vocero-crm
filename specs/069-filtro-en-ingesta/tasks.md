# 069 — Tareas (bloque B)

Un bloque: dos PRs (`vocero-crm` y `aliantis-brain`) y el estado en `aliantis-core`, revisados y unidos juntos.

- [x] T1 Spec, plan, modelo, enmienda del contrato y estas tareas. 067: su migración pasa a la `0029`.
- [x] T2 `src/server/privacy/filtrar.ts`, `webhook.ts` y `perfilVigente`; sus pruebas.
- [x] T3 `guardarEvento` filtra; prueba.
- [x] T4 `message.privacy_flags` (migración `0028`), probada sobre una base con datos.
- [x] T5 Ingesta: `marcas` obligatorias en `ingestInboundMessage`, los cuatro canales, segunda red; prueba.
- [x] T6 Laboratorio: filtra la línea de la persona.
- [x] T7 Despacho: `privacyFlags` y `organization.privacyProfileHash`; contrato gemelo intacto.
- [x] T8 Cerebro: `privacyProfileHash` y aviso; pruebas.
- [ ] T9 E2E con mocks: un mensaje de salud llega omitido a la bandeja y al cerebro falso. **Parcial en el PC:** `scripts/e2e-despacho.mjs` corrió 106 checks en verde, sin fallas (el caso 069, 9 de 9), hasta el Laboratorio; ahí Next en modo desarrollo se reinició por memoria (el PC tiene 3,9 GB). Lo que falta se corre en un Codespace si Andres lo aprueba.
- [x] T10 Revisión completa en los dos repos, 4 sabotajes, CI en verde. `AGENTS.md`, índice de specs, `estado.md`.
