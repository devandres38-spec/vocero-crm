# US — Consentimiento con botones, «No acepto» que borra y adjuntos por negocio (070)

Arnés: `scripts/e2e-consentimiento.mjs`, en `.github/workflows/e2e.yml` (etiqueta `e2e` en el PR). El guion hace de cerebro por `/api/bot/*`; el cerebro falso recibe los despachos y los avisos de olvido.

1. **Aviso con botones.** Un paciente escribe; el cerebro manda el aviso con «Acepto» y «No acepto». A WhatsApp sale un interactivo con los dos botones y la bandeja los muestra. Cuatro botones: 422.
2. **Acepto.** El paciente toca «Acepto»: el despacho lleva `buttonId` al final. `consent` lo registra (201), el contexto lo devuelve y `forget` responde `409 sin_rechazo` sin borrar nada.
3. **No acepto.** El paciente toca «No acepto»: `consent` registra el rechazo, `forget` borra los mensajes (repetirlo da `deleted: 0`), sale el texto fijo y es lo único que queda. Las entregas de `webhook_event` de esos mensajes ya no están; el consentimiento se conserva.
4. **Adjuntos apagados** (perfil de la demo, con salud). Una foto entra sin descargarse (`adjuntos_apagados`) y viaja con `mediaId: null`. Una tarjeta de contacto queda solo con el nombre y el teléfono enmascarado, también en `webhook_event`.
5. **Olvido con el cerebro caído.** Eliminar una conversación con el cerebro caído deja la fila en `olvido_pendiente`; al volver el cerebro, le llega `conversation.deleted` firmado y la fila se borra.
6. **Instagram y Messenger con botones nativos (077).** Cada canal se conecta directo con Meta, contra el mock de Graph: Instagram por `IG_GRAPH_BASE_URL` (`/graph/instagram`) y Messenger por `META_GRAPH_BASE_URL`.
   - **Aviso:** sale con los dos Quick Replies (`content_type: "text"`, el título y el id en `payload`), sin `409`, y la bandeja los muestra. Un título de 21 caracteres da 422.
   - **Acepto:** el toque llega con `quick_reply.payload`, el despacho lleva su `buttonId` y `consent` lo registra. Lo que el paciente escribe después se guarda filtrado.
   - **No acepto sin perfil legible:** con la huella del perfil rota, el toque se guarda con su título y su `button_id`. El rechazo se registra y `forget` borra la conversación. Después, la huella se restaura.
   - **El mock rechaza como Meta:** más de 13 botones, títulos de más de 20 y, en Instagram, tipos que no son de texto.
