# El cerebro en modo plataforma (070)

Con `TENANCY=multi`, **una sola Nea atiende a todos los negocios** que le
asignes. El CRM le despacha cada conversación firmada con el secreto de su
despliegue; Nea deriva de ese secreto la credencial de cada negocio y contesta
por `/api/brains/*`. Ningún negocio ve el secreto, y con la credencial de uno no
se lee ni se escribe nada de otro.

En `single` nada de esto aplica: sigue el despacho por `BRAIN_DISPATCH_URL` +
`BOT_API_KEY` y `/api/bot/*` (ver [README](../README.md)).

## 1. Desplegar Nea en modo `multiorg`

En Coolify (o donde corra), una Nea de la rama/versión de la 070 con:

| Variable | Valor |
|---|---|
| `VOCERO_MODE` | `cloud` |
| `CRM_ORGANIZATION` | **vacía** (vacía = atiende a varios negocios) |
| `CRM_BASE_URL` | La URL con la que Nea llega al CRM (p. ej. `http://vocero-crm:3000`) |
| `CRM_BRAIN_SECRET` | El secreto del paso 2 |
| `LLM_API_KEY` | **vacía**: en `multiorg` piensa el CRM con la llave de cada negocio |

`GET {nea}/health` debe decir `"mode":"multiorg"` y `"llm":"crm"`.

## 2. Registrar el cerebro en `/platform/cerebros`

1. **Registrar**: nombre y URL de despacho **con su ruta**
   (`http://nea:8000/vocero/dispatch`; sin ruta se rechaza). La URL de salud
   es opcional (por defecto, `/health` del mismo origen) y debe estar en el
   mismo origen. No se aceptan `localhost`, `127.0.0.0/8`, link-local ni
   metadatos de nube; sí las redes privadas de Docker/Coolify. Un cerebro mal
   escrito se corrige con **Editar**.
2. El CRM genera el secreto y lo muestra **una sola vez**: cópialo a
   `CRM_BRAIN_SECRET` de Nea y redespliégala. Si Nea ya tiene uno, activa
   «Pegar un secreto existente» (mínimo 32 caracteres).
3. **Probar**: debe decir «Sano · multiorg». «Responde, pero no es multiorg»
   significa que esa Nea tiene `CRM_ORGANIZATION` puesta.

El secreto se guarda cifrado (`ENCRYPTION_KEY`); después solo se ven sus
últimos 4. **Rotar** lo cambia en el acto en las dos direcciones: hasta que
pegues el nuevo en Nea, sus negocios quedan en bandeja manual y los despachos en
vuelo pasan a una persona. **Pausar** deja de despacharle a todos sus negocios.
Solo se borra un cerebro que no atiende negocios.

## 3. Asignarlo a cada negocio

Cualquiera de estos caminos (todos auditados como `cerebro_asignado`):

- La ficha del negocio → sección «Cerebro».
- El formulario del negocio → pestaña «Agente» → «Cerebro asignado».
- El Blueprint: `"brain": { "deployment": "brn_…" }` (`null` lo quita).
- `PUT /api/platform/organizations/{idOrSlug}/brain` con `{ "deployment": "brn_…" }`.
- Por MCP: `list_brain_deployments` para ver los ids y `apply_blueprint` con `brain`.

## 4. Lo que hace el dueño del negocio

- **Su llave de IA** en Ajustes → IA. En modo plataforma nada piensa con
  `OPENROUTER_*` del entorno (ni el cerebro ni el juez del Laboratorio): sin
  llave propia, el agente pasa la conversación a una persona.
- **Encender el agente** (pantalla Agente): exige un cerebro asignado, activo
  y que su `/health` conteste. La tarjeta «Quién responde» muestra el nombre del
  cerebro, nunca su URL.
- Con una llave de **OpenRouter**, las notas de voz se transcriben con el modelo
  que oye de Nea (`google/gemini-3.5-flash-lite`), pagado con esa llave. Con
  otro proveedor no se transcriben todavía (elegir el modelo por negocio queda
  para después de la 070).

## 5. Herramientas de módulo (072-B)

Un **módulo** (`src/modulos/<clave>/`) puede darle herramientas al cerebro.
Solo las define código revisado del CRM; un negocio no puede inventarlas.

- **Encender un módulo** es cosa de la agencia: `modules.modules` en el
  Blueprint del negocio (o por el MCP). El módulo de prueba es `diagnostico`
  (oculto a los dueños): `{"modules": {"modules": ["diagnostico"]}}`.
- Con el módulo encendido, `GET /api/brains/context` trae `moduleTools`
  (nombre, módulo, efecto, descripción y JSON Schema de los argumentos) y el
  cerebro las ejecuta con `POST /api/brains/tools/{name}`
  `{conversationId, dispatchId, args}`. Sin módulos, el contexto no cambia.
- El CRM recalcula los módulos en CADA llamada: una herramienta de un módulo
  apagado responde `404 tool_not_found`, igual que una que no existe.
- Las de **escritura** son idempotentes por despacho, nombre y argumentos
  (tabla `brain_tool_call`, 30 días): repetir la llamada devuelve la respuesta
  guardada sin volver a ejecutar.
- Topes: 8 herramientas por negocio, esquema ≤4 KB (≤12 KB entre todas),
  cuerpo ≤16 KB, 8 s por ejecución (`504 tool_timeout`), resultado ≤4 KB.
- La IA en pausa (`handoff` o el interruptor) responde `409 ai_paused` antes de
  ejecutar nada.

Para probarlo en staging: encender `diagnostico` en un negocio de prueba,
escribirle al agente «prueba el diagnóstico» y ver la marca en la nota interna
de la conversación y en `/m/diagnostico`. En otro negocio sin el módulo,
`/m/diagnostico`, `/api/m/diagnostico/*` y `/api/brains/tools/*` dan 404.

## Cómo se protege

- `/api/brains/*` autentica con `Authorization: Bearer <credencial>` +
  `X-Vocero-Organization`, donde la credencial es
  `HMAC-SHA256(secreto, "vocero:cerebro:v1:" + organization.id)`. Cualquier
  fallo es el mismo 401; 20 fallos por IP en 10 minutos, 429.
- `messages` solo acepta un `dispatchId` que el CRM despachó a ESE negocio y
  ESA conversación, y rechaza (409 `cerebro_reasignado`) la respuesta tardía de
  un cerebro al que ya se le quitó el negocio.
- La matriz `tests/unit/cerebros-070-aislamiento.test.ts` prueba cada ruta
  con la credencial de A contra recursos de B.
- `POST /api/brains/tools/{name}` busca módulos y conversación SIEMPRE en la
  organización de la credencial (`tests/unit/brains-tools.test.ts`).

Contrato completo: [specs/070-cerebro-multiorg/contracts/brains.md](../specs/070-cerebro-multiorg/contracts/brains.md)
· delta 072: [brains-072.md](../specs/072-motor-multi-nicho/contracts/brains-072.md)
· OpenAPI: [openapi-brains.json](openapi-brains.json).
