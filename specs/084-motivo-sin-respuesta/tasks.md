# 084 — Tareas (bloque P3)

Rama `feat/084-motivo-sin-respuesta`. En el PC: `vitest run` de lo tocado, eslint de lo tocado (sin prettier: reformatea archivos enteros), `pnpm db:generate` y un `tsc --noEmit`. El E2E (`e2e.yml`, etiqueta `e2e`) corre en Actions porque toca la base y el despacho.

- [x] **T1 Motivo `sin_respuesta`** (D1). `handoff.ts`, `schema.ts` (sin migración), `eventos-hilo.ts`, `analytics.ts`, `avisos/textos.ts` y el contrato 067 §7. Prueba: `motivos-aliantis.test.ts` (CA-1).
- [x] **T2 Laboratorio y juez** (D2, D3). `personas.ts`, `negocio.ts`, `judge.ts`, `prompts.ts` y `lab-client.tsx`. Pruebas: `juez-sin-necesidad.test.ts` (CA-2, CA-3) y `laboratorio-por-negocio.test.ts`.
- [ ] **T3 Cierre.** `tsc --noEmit`, `graphify update .`, CI y `e2e.yml` en verde (CA-4). Después del merge: `actualizar.sh` en el Preview, antes de desplegar el cerebro.
