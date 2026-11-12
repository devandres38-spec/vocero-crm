# 077 — Tareas (bloque I2, paso 4.7)

**Cómo se trabaja:**
- un commit por paso, cada uno con las pruebas de su módulo;
- PRs:
  - `vocero-crm`: código y spec;
  - `aliantis-brain`: spec `013-botones-meta`;
  - `aliantis-core`: `decisiones.md` y `estado.md`.
- Un solo merge por repo, con la palabra de Andres.
- Lleva la etiqueta `e2e`: toca la ingesta y el envío.

**Orden pensado para no dejar `main` roto:**
- primero se guarda el botón al entrar (T2);
- después se abre el envío (T3 y T4);
- mientras tanto, el `409` sigue.

- [x] T1 Spec y estas tareas, con las respuestas de Andres.
- [x] T2 **La ingesta guarda el botón:**
  - `processMetaInstagramPayload` y `normalizeMetaPagePayload` leen `message.quick_reply.payload` y lo pasan como `botonId` (hasta 256 caracteres);
  - pruebas: con perfil, sin perfil (el título se conserva), un `payload` largo y los ecos.
  - **Sabotaje 2.**
- [x] T3 **La capacidad y el contrato:**
  - `botones` en `capabilities.ts`;
  - la ruta `/api/bot/messages` y `sendText` consultan la capacidad y la fuente (Meta sí, Zernio no);
  - el Laboratorio admite los botones en Instagram y Messenger;
  - `docs/openapi.json` al día;
  - pruebas de la ruta: el `409` sigue en TikTok y en Zernio.
  - **Sabotaje 3.**
- [x] T4 **El envío:**
  - `quick_replies` en `sendViaMeta` de Instagram y en `buildMessengerSendBody`;
  - `callInstagramSend` y `callMessengerSend` reciben los botones;
  - el saliente los guarda;
  - pruebas del cuerpo exacto en los dos canales.
  - **Sabotaje 1.**
- [ ] T5 **El mock y el E2E:**
  - el mock de Graph valida `quick_replies` como Meta (pregunta 3);
  - `IG_GRAPH_BASE_URL` en `e2e.yml`;
  - `e2e-consentimiento` gana Instagram (fuente Meta) y Messenger, cada uno con:
    - el aviso sale con los botones;
    - el toque de «Acepto» registra el consentimiento;
    - el de «No acepto» sin perfil borra la conversación;
    - lo que se escribe se guarda filtrado;
  - `tests/e2e/us-consentimiento.md`.
- [ ] T6 **Documentación:** `AGENTS.md`, el mapa de canales y la guía de prueba real (confirmar en vivo el host de Instagram y `messaging_type`). Revisión: CI en verde, `e2e.yml` en verde y los sabotajes en PRs borrador que se cierran sin merge.
- [ ] T7 **Core:**
  - `decisiones.md`: los límites de Meta, lo escrito que cuenta y Zernio;
  - `estado.md`: el bloque I2 listo;
  - `RELEVO_ARQUITECTURA.md` corrige lo de «tras 3 avisos» (en el espacio, PR aparte).
