# US — Contrato con aliantis-brain: salud con el Agente apagado, historial, omisión, envío idempotente, motivos, notas y avisos (071)

Arnés: `scripts/e2e-contrato-aliantis.mjs`, en `.github/workflows/e2e.yml` (etiqueta `e2e` en el PR, con `AVISOS=on` y el mock de Telegram). El guion hace de cerebro por `/api/bot/*`.

1. **Salud con el Agente apagado (3.8).** Un mensaje de salud se despacha con `conversation.agentEnabled: false`. Sin `motivo`, `messages` da `409 agente_apagado`; con `motivo: "seguridad"`, sale; un segundo, 409. Un mensaje sin salud no se despacha.
2. **Historial y notas (3.6).** Una nota interna con salud se guarda omitida. El historial viene del más viejo al más nuevo, con el entrante omitido y sus marcas, y sin notas internas. Una conversación ajena da 404. Las notas del contacto enmascaran el teléfono.
3. **Omisión.** `omit` deja el texto omitido en la bandeja y borra la entrega de `webhook_event`; repetirlo da lo mismo.
4. **Envío idempotente.** El mismo `clientMessageId` dos veces: una sola salida a WhatsApp y `repetido: true`.
5. **Motivos y avisos (3.7, 3.10).** Un traspaso por `salud` queda con ese motivo. Al grupo llega el aviso con el motivo en palabras y la referencia, sin nombre, teléfono ni texto. La persona vuelve a escribir: un seguimiento; un segundo mensaje enseguida no lo repite.

## 078 — La etapa por eventos y la ficha con lista blanca (D18, D12)

1. **El mapeo:** el dueño mapea en la pantalla de etapas `primera_respuesta` y `servicio_consultado` a dos etapas abiertas. A una etapa ganada responde `409 etapa_cerrada`.
2. **Los eventos:**
   - `primera_respuesta` mueve al lead a su etapa; repetirlo da `ya_esta`;
   - `servicio_consultado` lo adelanta, y un evento de una etapa anterior no lo devuelve (`ya_esta`);
   - un evento sin etapa da `sin_etapa`;
   - `evento` y `stage` a la vez dan 422.
3. **La ficha del cerebro:**
   - `servicio_interes` y `quiere_cita` se guardan;
   - una clave ajena da `422 clave_no_permitida`;
   - un valor con salud no se guarda (ni el marcador) y queda el anterior.
4. **Con una persona atendiendo:** `409 ai_paused` en la etapa y en la ficha.
5. **En el Laboratorio:** `200` con `prueba`, sin escribir nada.
