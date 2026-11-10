# 067 — Tareas

La spec se escribe entera ahora (paso 0.2), pero se implementa por partes, en el orden del plan maestro (`RELEVO_ARQUITECTURA.md`, sección 9; D6 de Aliantis: contrato → cerebro → privacidad en Vocero → multi-tenant). Cada bloque es su propio paso, con su rama, su PR y el "sigue" de Andres. En cada uno: pruebas que fijen lo que no debe cambiar **antes** de tocar, gates en verde dichos con números, sus sabotajes de `plan.md` y `aliantis-core/docs/trabajo/estado.md` al día.

## Paso 0.2 — Especificación (este PR)

- [x] T1 `spec.md`, `plan.md`, `data-model.md`, `contracts/bot-api-v2.md`, `contracts/despacho-v2.md` y este archivo, antes del código.
- [ ] T2 Andres revisa y aprueba el contrato.

## Fases 1 y 2 — En `aliantis-brain` (su propia spec)

- [ ] T3 Vocero simulado en las pruebas del cerebro que cumple estos dos contratos.
- [ ] T4 Prueba gemela de la credencial derivada con el vector de Nea (`org_abc123`) y del cuerpo del despacho con la fixture de `tests/unit/despacho-contrato.test.ts`.

## Fase 3 — Privacidad en Vocero (bloques de esta spec)

- [ ] T5 Migración `0028` (antes `0027`, ver 068) (`consent`, `message.privacy_flags`, `button_id`, `buttons`) + prefijo `cns_`. Prueba: la migración aplica sobre una base con datos.
- [ ] T6 Historial: `GET /api/bot/history`. Sabotaje 15.
- [ ] T7 Marcas en el despacho: `privacyFlags` en `armarEvento`, solo si existen. Gemelo intacto. Sabotaje 11. (Quien llena `privacy_flags` es la spec del filtro, paso 3.2.)
- [ ] T8 Botones: `buttons` en `messages`, `kind: "buttons"` en `sendStructured`, `button_id` en la ingesta, `buttonId` en el despacho, botones visibles en la bandeja. Sabotajes 12 y 16.
- [ ] T8c Segunda red de salud: `POST /api/bot/omit` (historia 9). Sabotajes 20 y 21. (Del lado del cerebro, el turno lo llama antes del punto de control en el paso 2.4c.)
- [ ] T8b Envío idempotente: `clientMessageId` en `messages`, columna e índice único parcial (en la misma migración `0028`), reserva antes de Meta, historia 8 en el guion E2E. Sabotajes 17, 18 y 19. (Del lado del cerebro, el turno genera la llave en el paso 2.4.)
- [ ] T9 Consentimiento: `src/server/consent.ts`, `POST /api/bot/consent`, `consent` en el contexto, escaneo de solo agregar.
- [ ] T10 Forget: `src/server/inbox/olvidar.ts` y `POST /api/bot/forget`. Sabotajes 6, 7 y 8.
- [ ] T11 Salud con el Agente apagado: despacho con `agentEnabled: false` y regla de seguridad en `messages`. Sabotajes 9 y 10.
- [ ] T12 Motivos: catálogo, `HANDOFF_LABEL` y rótulos del hilo. Sabotaje 14.
- [ ] T13 Guion `tests/e2e/us-contrato-aliantis.md` + `scripts/e2e-contrato-aliantis.mjs` (aviso, «No acepto», salud con el Agente apagado), con cerebro falso.

## Fase 4 — Multi-tenant (bloque de esta spec)

- [ ] T14 `credencialDerivada` + `requireBot` con las seis reglas de `bot-api-v2.md`; las 12 rutas migradas; escaneo de que ninguna ruta use otra cosa. Sabotajes 1 a 4.
- [ ] T15 Presupuesto y «quién responde» por organización. Sabotaje 5.
- [ ] T16 Prueba de aislamiento con dos organizaciones sobre todas las rutas de `/api/bot/*`.

## Fase 5 — Aprovechar Vocero (bloque de esta spec)

- [ ] T17 `reset` solo en el Laboratorio. Sabotaje 13.

## Al cerrar cada bloque

- [ ] `docs/openapi.json`, `AGENTS.md` y la enmienda de `specs/021-despacho-estandar/contracts/despacho.md` con lo que ese bloque agregó.
- [ ] `graphify update .`
