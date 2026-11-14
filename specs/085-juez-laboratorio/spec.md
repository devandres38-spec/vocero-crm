# 085 — El juez del Laboratorio no alucina traspasos ni silencios (bloque P4)

Bloque P4 de Aliantis (la parte del cerebro es la spec 023 de `aliantis-brain`). Andres aprobó el plan con las cuatro recomendaciones. Origen: la corrida `run_vee0rkncq62se39z1b2q` de Academia Futuro en el Preview (14-nov-2026, score 83):

- `sin_rumbo` salió en **rojo** con `derivo_sin_necesidad`, aunque **no hubo traspaso**: el bot se despidió al «ok» y calló ante «jaja», «👍», «ok gracias» y «listo» (el candado de cierre del cerebro). El juez inventó la derivación.
- `agenda_ignora` salió en **amarillo** porque el juez esperaba que el bot «recordara» el aviso de privacidad; la regla aprobada en el bloque P1 es **no repetirlo** y pasar a una persona si insiste en agendar.

## Lo que había (revisado en el código)

- `buildJudgePrompt` ya tenía las reglas de `derivo_sin_necesidad` y de `agenda_ignora`, pero el juez **solo recibía la clave de la persona** (`sin_rumbo`), no su descripción, que dice lo que se espera.
- El silencio no quedaba en la transcripción: el juez veía cuatro líneas del cliente seguidas, sin explicación.
- El runner espera 45 s (`SILENCIO_MS`) antes de leer el silencio como respuesta. **El cerebro no avisa cuando calla a propósito** (la regla `cierre_silencio` no llama a ningún endpoint): sin una señal, Vocero no distingue «calló» de «sigue pensando».

## Decisiones

- **D1. El juez recibe la descripción de la persona** (`personas.ts`): «PERSONA SIMULADA: sin_rumbo — Solo manda relleno: el bot se despide una vez y deja de perseguir; no pasa el chat al equipo.»
- **D2. Freno en código después del juez (P4)** en `judge.ts`, `frenarVeredicto`:
  - sin una línea SISTEMA de traspaso en la transcripción, se descarta `derivo_sin_necesidad`;
  - con una, se descarta `debio_escalar`;
  - si el código descartó algo y no queda ningún hallazgo, el veredicto pasa a `verde`. Si quedan otros, el veredicto del juez no cambia.

  Lo ambiguo lo resuelve el código, como en el bot: el traspaso es un hecho del CRM, no una opinión del juez.
- **D3. Prompt del juez:**
  - «SISTEMA: El agente no respondió a este mensaje» es silencio, no traspaso. Callar ante relleno después de despedirse es correcto (no persigue al cliente).
  - En `agenda_ignora`: no repetir ni «recordar» el aviso es la regla aprobada, no algo mejorable; no es amarillo ni tono.
- **D4. El silencio queda en la transcripción** (`runner.ts`): cuando el despacho se entregó y el agente no escribió en `SILENCIO_MS`, se agrega la línea SISTEMA «El agente no respondió a este mensaje.».
- **D5. Los 45 s se quedan (P3, opción b).** Bajarlos sin una señal del cerebro podría desordenar la transcripción en un turno lento con la reescritura encendida. La señal real (`POST /api/bot/silencio`, que serviría también en la bandeja) queda para otro bloque.

## Criterios de aceptación

- **CA-1.** Un veredicto rojo con solo `derivo_sin_necesidad` y sin traspaso en la transcripción queda `verde` y sin hallazgos. Con un traspaso, el hallazgo se queda.
- **CA-2.** Con un traspaso, `debio_escalar` se descarta. Con otros hallazgos además del descartado, el veredicto no cambia.
- **CA-3.** El prompt lleva la descripción de la persona, la regla del silencio y la de no repetir el aviso.
- **CA-4.** El runner escribe la línea SISTEMA del silencio, y no la escribe si el agente contestó o traspasó.
- **CA-5.** Corrida nueva del Laboratorio en Academia Futuro (Preview): `sin_rumbo` y `agenda_ignora` en verde.
