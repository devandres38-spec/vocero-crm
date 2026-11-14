# 083 — Tareas (bloque P2)

Rama `083-laboratorio-por-negocio`. En el PC: `vitest run` de lo tocado, eslint de lo tocado (sin prettier: reformatea archivos enteros) y un `tsc --noEmit`. El E2E (`e2e.yml`, etiqueta `e2e`) corre en Actions porque toca el despacho del Laboratorio.

- [x] **T1 El negocio del cerebro** (D1). `src/server/lab/negocio.ts`: `pedirNegocioDelLab` (firma con la llave derivada `aliantis:lab:negocio:v1`, 3 s, zod, `null` si falla o si llega otro negocio) y `renderNegocio`.
- [x] **T2 Guiones por negocio** (D2). `personas.ts`: plantillas `{s1}`, `{s2}`, `{s3}` y `{s1_min}`; `guionDe`, `serviciosDelGuion` y `personasParaNegocio`; sin ferretería, en español neutro de Colombia; personas nuevas `agenda_rechaza`, `agenda_ignora`, `deja_datos` y `salud`; `alAviso`. `agent-roles.ts` las lista.
- [x] **T3 Runner** (D3, D4, D5, D7). El negocio una vez por corrida; el guion del negocio; `respuestaAlAviso` (el botón según `alAviso`); la transcripción sobre la marcha; `limpiarConsentimientoDePrueba` con la guarda `esContactoDelLaboratorio`. `privacidad-entrantes.test.ts`: el patrón del filtro con el botón.
- [x] **T4 Juez** (D6). `buildJudgePrompt` y `judgeCase` con los datos del negocio y las reglas del consentimiento de Aliantis.
- [x] **T5 Pruebas** `tests/unit/laboratorio-por-negocio.test.ts` (CA-1 a CA-3, CA-5, CA-6) y el E2E (`cerebro-falso.mjs` sirve `/vocero/lab/negocio`; `e2e-despacho.mjs` comprueba la firma, el servicio del catálogo en las líneas y la persona de salud: CA-7). **Sabotajes S1 a S4: 4 de 4 detectados** (corridos a mano con el pool normal; con `vmThreads`, el Vitest de Vocero no encuentra las pruebas).
- [x] **T5b Excepción a la 070** (hallazgo del CI, aprobada por Andres). `consentimiento.test.ts`: solo `runner.ts` puede borrar en `consent`, y detrás de la guarda. Sabotaje S4.
- [x] **T6 Cierre.** `graphify update .`, `CLAUDE.md` (mapa), casillas. Después del merge: `actualizar.sh` en el Preview y una corrida real del Laboratorio en Academia Futuro.
