# US — Autenticación por negocio: credencial derivada y App Secret por negocio (073)

Arnés: `scripts/e2e-multinegocio.mjs`, en `.github/workflows/e2e.yml` (etiqueta `e2e` en el PR), el último: usa el negocio del operador que dejan conectado los demás arneses (PN-E2E-1) y deshace lo suyo al terminar.

1. **Dos negocios en `/api/bot/*`.** A (el del operador) y B (sembrado en la base).
   - A, con la credencial derivada de A, ve su conversación; B, con la suya, recibe 404 en esa misma conversación.
   - La credencial de A con la cabecera de B da 401, y la llave cruda con cabecera también.
   - La llave cruda sin cabecera, con dos negocios, da `409 organizacion_requerida`.
   - Un negocio que no existe da 401.
2. **El App Secret de A.** Se registra con el comando real, `pnpm meta:secreto -- --organizacion A --canal whatsapp`, por la entrada estándar. Solo muestra los últimos 4, y en la base queda cifrado.
3. **El webhook de WhatsApp de A.**
   - Firmado con otro secreto, o sin firma: 401, y nada en `webhook_event` ni en `message`.
   - Firmado con el secreto de A: 200, y el mensaje entra en la bandeja de A.

Además, en los otros arneses el cerebro falso y el guion contestan con la credencial derivada del negocio, como el cerebro real. La llave cruda (compatibilidad, con un solo negocio) se sigue probando en el proxy `/api/bot/llm` de `e2e-despacho`.
