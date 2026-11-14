# 083 — Laboratorio por negocio (bloque P2)

**Estado:** aprobada por Andres el 13-nov-2026 dentro del plan del bloque P2 (P5: catálogo por endpoint firmado del cerebro; P6: bloque aparte, después del P1). Decisión nueva al planearlo: **borrar el consentimiento solo del contacto sintético de cada persona al empezar su caso** (respuesta de Andres). Rama `083-laboratorio-por-negocio`. La otra mitad está en `aliantis-brain/specs/021-lab-negocio/` (PR #104).

**Origen:** la prueba del Preview en Academia Futuro, el 13-nov-2026. Había tres problemas:
- `src/server/lab/personas.ts` tenía guiones fijos de una ferretería (taladros, martillos, pintura) para todos los negocios;
- el cliente simulado no respondía al aviso de privacidad;
- el juez comparaba contra la base de conocimiento de Vocero, que el cerebro no usa (D17).

**Riesgo:** toca el Laboratorio (`is_test`, sandbox intacto) y borra filas de `consent`, **solo** de los contactos sintéticos del Laboratorio. No toca el esquema ni las migraciones. El contrato nuevo cerebro ← Vocero es solo de lectura.

## Hoy (verificado contra el código el 13-nov-2026, `main` en `ebb1851`)

- `personas.ts`: 8 personas con `script: string[]` fijo y teléfonos sintéticos `52100000000N`. Las lista el rol en `src/lib/agent-roles.ts` (`calificador.personas`), y `roles-como-datos.test.ts` exige que existan todas.
- `runner.ts`:
  - `startRun` crea los casos con `personasDelRol`;
  - `runConversation` manda las líneas una tras otra con `turnoPorDespacho` y corta en el primer traspaso;
  - la transcripción se lee de `message` **al final**, después de que un «No acepto» del cerebro ya la borró con `forget`.
- `upsertTestContact` reutiliza el mismo contacto sintético por persona (archivado). `consent` se consulta **por contacto** (`src/server/consent.ts:85`), así que un «Acepto» de una corrida quedaría para las siguientes.
- Los salientes del bot guardan sus botones en `message.buttons`. Un botón entrante es `type: 'interactive'`, con `buttonId`, y se filtra con `filtrarTexto(texto, politica, botonId)`.
- `judge.ts` / `buildJudgePrompt` (`src/server/ai/prompts.ts`) reciben `kbText` (la base de conocimiento de Vocero) y `behaviorText`.
- Llamada firmada al cerebro, el patrón a seguir: `src/server/panel/gasto.ts` (origen de `BRAIN_DISPATCH_URL`, llave derivada de `BOT_API_KEY`, 3 s, `null` si falla).

## Diseño

- **D1. `src/server/lab/negocio.ts`:** `pedirNegocioDelLab(organizationId)` → `POST <origen de BRAIN_DISPATCH_URL>/vocero/lab/negocio`.
  - Firma con `HMAC(BOT_API_KEY, "aliantis:lab:negocio:v1")` y cuerpo `{en, organizationId}`.
  - Espera 3 s y valida la respuesta con zod. Si algo falla, `null`: el Laboratorio sigue con guiones neutros.
  - `renderNegocio()` arma el texto para el juez.
- **D2. Personas con guion por negocio** (`personas.ts`):
  - `script` son plantillas con `{s1}`, `{s2}` y `{s3}`, servicios del catálogo: `s1` y `s2` con precio; `s3` sin precio, si hay alguno, para probar el «responde una persona».
  - `guionDe(persona, negocio | null)` las llena; sin catálogo usa frases neutras («su servicio más pedido»).
  - Redacción en español neutro de Colombia, sin la ferretería.
  - Personas nuevas: `agenda_rechaza`, `agenda_ignora`, `deja_datos` y `salud` (esta solo si el negocio tiene filtro de salud); `comprador_decidido` ahora pide agendar y acepta.
  - Cada persona dice qué hace ante el aviso: `alAviso: 'acepta' | 'rechaza' | 'ignora'` (por defecto, ignora).
- **D3. El cliente simulado responde al aviso** (`runner.ts`): después de cada turno, si el último saliente trae el botón `consentimiento:acepto` y la persona acepta o rechaza, la siguiente línea es ese botón (`interactive`, título y `buttonId`). Pura y probada: `respuestaAlAviso`.
- **D4. La transcripción se arma sobre la marcha:** cada línea del cliente al insertarla y cada saliente nuevo después de cada turno (por id). Así un «No acepto», que borra los textos en Vocero, no deja el caso vacío.
- **D5. Consentimiento limpio por caso:** al empezar cada caso se borran las filas de `consent` del contacto **solo si** es del Laboratorio. La guarda es pura (`esContactoDelLaboratorio`): teléfono de la lista de personas y contacto archivado. Nunca toca un contacto real. **Es la única excepción a la invariante de la 070** («consent es de solo agregar»), que encontró el CI y aprobó Andres: `consentimiento.test.ts` sigue prohibiendo `update`/`delete` sobre `consent` en todo `src/` salvo `runner.ts`, y exige que ese `delete` vaya detrás de la guarda.
- **D6. Juez:**
  - recibe los datos del negocio del cerebro (D1) además de la base de conocimiento;
  - el prompt aprende las reglas de Aliantis: responder consultas sin pedir autorización es correcto; pedirla al agendar o al dejar datos es correcto; aceptar → traspaso; rechazar → despedida con el teléfono; un dato faltante (precio o duración) → una persona; salud → frase fija y una persona.
- **D7. `startRun`:** pide el negocio una vez y deja fuera la persona `salud` si el negocio no tiene filtro de salud o no hubo catálogo.

## Criterios de aceptación

- **CA-1:** con el catálogo de la academia, ninguna línea nombra un taladro, un martillo ni pintura, y `{s1}` es un curso con precio.
- **CA-2:** sin cerebro (o con 404), la corrida sigue con frases neutras; ninguna línea queda con `{…}`.
- **CA-3:** una persona que acepta responde al aviso con el botón «Acepto»; la que rechaza, con «No acepto»; la que ignora sigue su guion.
- **CA-4:** la transcripción del caso que rechaza conserva sus líneas, aunque `forget` borre los textos.
- **CA-5:** en la segunda corrida, una persona que aceptó en la primera vuelve a ver el aviso (D5), y la guarda nunca borra el consentimiento de un contacto que no es del Laboratorio.
- **CA-6:** el prompt del juez trae los datos del negocio y las reglas del consentimiento.
- **CA-7:** el E2E (`e2e.yml`) con el cerebro simulado: las líneas nombran el servicio del catálogo simulado, cada caso trae lo del cerebro y nada sale por WhatsApp.

## Sabotajes

- S1: la guarda de D5 acepta cualquier contacto → falla CA-5.
- S2: el cliente de D1 firma con la llave del gasto → falla su prueba.
- S3: `respuestaAlAviso` ignora el aviso → falla CA-3.
- S4: el borrado sin la guarda → falla la prueba de la excepción en `consentimiento.test.ts`.
