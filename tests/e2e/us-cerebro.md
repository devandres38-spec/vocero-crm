# E2E 070 — Una Nea `multiorg` para dos negocios (staging)

Requisitos: CRM 2.10.0 con `TENANCY=multi`; Nea de la rama 070 con
`VOCERO_MODE=cloud`, `CRM_ORGANIZATION` vacía, `CRM_BRAIN_SECRET` del paso 1;
dos negocios **A** y **B** con WhatsApp conectado (o el wa-mock) y cada uno con
**su** llave de IA (A: OpenRouter; B: otro proveedor compatible).

## Camino feliz

1. `/platform/cerebros` → Registrar `http://nea:8000/vocero/dispatch`. Copiar el
   secreto a Nea y redesplegar. «Probar» → «Sano · multiorg».
2. Asignar el cerebro a A (ficha) y a B (Blueprint `brain` por MCP o REST).
   Auditoría: dos `cerebro_asignado`.
3. En A y en B: encender el agente (debe permitirlo). La tarjeta «Quién
   responde» muestra el NOMBRE del cerebro, sin URL.
4. Un cliente le escribe a A → Nea contesta en el hilo de A (mensaje con IA).
   La respuesta entra por `/api/brains/messages` (201) con el `dispatchId`.
5. El agente de A mueve la etapa del lead (`/api/brains/stage`) y llena la ficha.
6. Con agenda encendida en A: pedir cita → huecos → reservar (cita en Agenda).
7. Nota de voz a A (OpenRouter) → se transcribe y se contesta.
8. El mismo número le escribe a B → contesta B, con el conocimiento de B, y el
   historial de A no aparece.
9. Laboratorio de A → corre contra el cerebro; el juez gasta la llave de A.
10. Eliminar una conversación de A → Nea recibe `conversation.deleted` (log de
    Nea: «olvido de cv_…»).

## Camino infeliz

1. Quitar la llave de IA de B → el siguiente mensaje de B pasa a una persona
   (handoff `modelo`), y NO se usa `OPENROUTER_*` del entorno.
2. Apagar la agenda de B (módulos) → la sonda de Nea concluye «sin agenda»: el
   agente de B deja de ofrecer citas.
3. Pausar el cerebro → los mensajes nuevos quedan en la bandeja; encender el
   agente responde 409 con el nombre del cerebro.
4. Rotar el secreto sin actualizar Nea → los despachos caducan a una persona;
   al pegar el nuevo, vuelve a contestar.
5. Suspender A → no se despacha nada de A; B sigue contestando.
6. Reasignar A a otro cerebro con un turno en vuelo → la respuesta tardía del
   viejo recibe 409 `cerebro_reasignado` (log del CRM) y no se envía.
7. `curl` a `/api/brains/context` con la credencial de A y
   `X-Vocero-Organization` de B → 401.
