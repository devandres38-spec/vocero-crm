# Guion E2E — US4: Laboratorio (SIEMPRE contra ai-mock, determinista)

> Conducido con Playwright (MCP) contra `pnpm dev` con ai-mock. El KB inicial
> NO cubre garantías/devoluciones (hueco intencional del guion).
>
> 036 — El Laboratorio prueba al agente conectado: las personas le escriben
> por el despacho (`conversation.test = true`, 033) y el cerebro contesta por
> `/api/bot/messages`, que guarda la respuesta sin enviarla. Hace falta la app
> con `BRAIN_DISPATCH_URL` + `BOT_API_KEY` hacia un cerebro (Nea apuntando al
> ai-mock, o el cerebro del arnés de `scripts/e2e-despacho.mjs`). El juez usa
> la llave de Aliantis (`OPENROUTER_*` del entorno, 080) y, hacia OpenRouter,
> los proveedores fijos. El score esperado depende del cerebro; los números de
> abajo son los del cerebro del arnés.

## Preparación

1. `DELETE /api/dev/wa-mock/outbox` — el outbox debe seguir VACÍO al final.
2. Agente configurado (US3), la llave del entorno apuntando al ai-mock, un
   cerebro conectado y sano, y la sesión de un `owner` o `admin`.

## Corrida 1

3. En `/lab`: pulsar "Correr evaluación".
   ✅ La UI muestra el subtítulo permanente "Sandbox interno — no envía
   mensajes reales", progreso en vivo (n/6) sin bloquear la navegación.
4. Al terminar:
   ✅ Reporte con score global (5 verdes + 1 rojo ≈ 83), tarjeta de la persona
   "Pregunta fuera del conocimiento" con hallazgo `fuera_de_kb`, evidencia y
   sugerencia; transcript visible por persona.
   ✅ La persona "Pide un humano" terminó en handoff (guion cortado): el
   cerebro llamó a `POST /api/bot/handoff`.
   ✅ `GET /api/dev/wa-mock/outbox` → VACÍO (ningún mensaje salió a WhatsApp).
   ✅ Las conversaciones de prueba NO aparecen en la bandeja.

## Cerrar el loop

5. En el hallazgo: "Agregar al conocimiento" → editar/confirmar → guardado en
   el KB (visible en `/agent`).
6. Re-correr la evaluación.
   ✅ El historial muestra 2 corridas; la nueva con score 100 y delta +17.

## Caminos infelices

7. Con una corrida en curso, `POST /api/lab/runs` → 409 `run_in_progress`.
8. Corridas huérfanas: cubierto por `src/instrumentation.ts` al boot
   (verificación en el checkpoint de compose, donde el server se reinicia).
9. **036** Sin cerebro (app sin `BRAIN_DISPATCH_URL`): `POST /api/lab/runs` →
   409 `sin_cerebro`, no se crea ninguna corrida y `/lab` explica que hay que
   conectar un agente primero, con el enlace a la receta.
10. **080** Sin la llave de Aliantis en el entorno: `POST /api/lab/runs` → 409
    `laboratorio_sin_llave` y `/lab` dice «El Laboratorio no está disponible
    ahora. Avísale a Aliantis», sin enlace a Ajustes → IA.
11. **080 (D20)** El tope diario (3 por defecto, lo cambia Andres desde su
    panel, de 0 a 20): `/lab` dice «Te quedan N corridas hoy»; con el tope
    alcanzado, el botón queda deshabilitado con «Vuelve a estar disponible
    mañana» y `POST /api/lab/runs` → **429** `tope_laboratorio` sin crear
    corrida. Cuenta toda corrida creada desde la medianoche del negocio, también
    las fallidas. Con el tope en 0, 429 con «apagado».
12. **080 (P3)** Un `member` ve el historial pero no corre: `POST /api/lab/runs`
    → **403** `forbidden` y el botón está deshabilitado con la explicación.
