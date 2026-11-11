# US — Retención por negocio con borrado diario (072)

Arnés: `scripts/e2e-retencion.mjs`, en `.github/workflows/e2e.yml` (etiqueta `e2e` en el PR). Corre contra Postgres real: siembra directo en la base y dispara la pasada por `POST /api/dev/retencion` (solo con mocks, 404 en producción).

1. **Dos negocios.** A con `retencion_dias = 7`; B sin perfil de privacidad (90). Cada uno con filas de 1, 10 y 100 días en mensajes, adjuntos, notas internas, citas, etapas, contactos, Laboratorio y `webhook_event`. La pasada informa 7 y 90 días.
2. **Mensajes.** Lo que pasa del corte queda como `[mensaje borrado por antigüedad]`, sin botones ni adjunto; la fila se queda. Lo reciente y lo que cae justo en el corte, intactos.
3. **Adjuntos.** El que solo usaba un mensaje viejo se borra; el compartido con un mensaje reciente y la imagen de la tarjeta del anuncio se quedan; el huérfano viejo se borra y el nuevo no.
4. **Lo demás.** Nota interna vieja borrada; la cita pasada pierde su nota y la futura la conserva; la nota de pérdida se vacía y el motivo se queda; el contacto inactivo pierde notas y ficha pero conserva nombre, teléfono e identidad; el activo conserva todo; el caso viejo del Laboratorio pierde la transcripción; el `webhook_event` viejo se borra aunque esté agotado.
5. **Lo que no se toca.** Consentimiento, tarjeta del anuncio, lead y conversación.
6. **Resultados e idempotencia.** Las filas de mensajes por dirección, origen y estado son las mismas antes y después. Una segunda pasada no cambia nada.
