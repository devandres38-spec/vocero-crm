# 085 — Tareas (bloque P4)

Rama `feat/085-juez-laboratorio`. En el PC: `vitest run` de lo tocado, eslint de lo tocado (sin prettier: reformatea archivos enteros) y un `tsc --noEmit`. No toca la base, el webhook ni el despacho (el runner solo lee): el CI de GitHub basta, sin `e2e.yml`.

- [ ] **T1 Freno del veredicto** (D2). `judge.ts`. Prueba: `juez-freno-085.test.ts` (CA-1, CA-2). **Sabotaje S1** (sin freno).
- [ ] **T2 Prompt y persona** (D1, D3). `prompts.ts`, `judge.ts` y `runner.ts`. Prueba: `juez-freno-085.test.ts` (CA-3).
- [ ] **T3 El silencio en la transcripción** (D4). `runner.ts`. Prueba (CA-4). **Sabotaje S2** (sin la línea).
- [ ] **T4 Cierre.** `tsc --noEmit`, `graphify update .`, CI en verde. Después del merge: `actualizar.sh` en el Preview y una corrida del Laboratorio en Academia Futuro (CA-5).
