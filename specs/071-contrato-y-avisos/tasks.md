# 071 — Tareas (bloque D)

Un commit por paso, cada uno con las pruebas de su módulo. PRs: `vocero-crm` (código, spec y `CLAUDE.md`), `aliantis-brain` y `aliantis-espacio` (solo el método en `CLAUDE.md` y el RELEVO), `aliantis-core` (método, `decisiones.md` y `estado.md`). Un solo merge.

- [ ] T1 Spec y estas tareas (aprobadas por Andres).
- [ ] T2 Migración `0030`: `message.client_message_id` y su índice único parcial, `aviso_canal`, `aviso_traspaso`; prefijo `avs`. `pnpm db:generate` sin diferencias.
- [ ] T3 (3.7) Motivos de Aliantis en el catálogo, sus rótulos y el OpenAPI; prueba contra la lista del cerebro. Sabotaje opcional 14.
- [ ] T4 (3.6) Notas internas, notas del contacto, notas de citas y valores de la ficha por el filtro; `/api/bot/bookings` descarta `notes`. Sabotajes: nota y ficha sin filtrar.
- [ ] T5 `GET /api/bot/history`. Sabotaje 15.
- [ ] T6 `POST /api/bot/omit` y el evento SSE `message.updated`. Sabotajes 20 y 21.
- [ ] T7 `clientMessageId`: reserva antes de Meta, repetido, en curso, reintento de un fallido o de una reserva vieja (2 min), Laboratorio. Sabotajes 17, 18 y 19.
- [ ] T8 (3.8) Salud con el Agente apagado: encolar, entregar (`agentEnabled: false`) y `messages` con `motivo: "seguridad"`. Sabotajes 9 y 10.
- [ ] T9 (3.10) Avisos por Telegram: bandera `AVISOS`, `aviso_canal` con `pnpm avisos:grupo`, aviso al traspasar, seguimiento con freno de 30 minutos, reintentos en el worker, mock de desarrollo, `AVISOS=on` en el CI `completo`. Sabotajes: aviso con datos del contacto, seguimiento sin freno, token en el log.
- [ ] T10 `e2e-contrato-aliantis.mjs` y su guion, en `e2e.yml`.
- [ ] T11 `docs/openapi.json`, `AGENTS.md`, enmienda del contrato del despacho, `estado.md` y `decisiones.md`. CI y `e2e.yml` en verde.
