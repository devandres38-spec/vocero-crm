/**
 * 073 (D14 de Aliantis) — En producción, la firma de un webhook es
 * obligatoria: sin secreto registrado, la entrega se rechaza. Los mocks nunca
 * corren en producción (`src/lib/dev-guard.ts`). Aparte de `firma.ts` para que
 * Zernio lo use sin importar la resolución de organizaciones (ciclo).
 */
export function firmaObligatoria(): boolean {
  return process.env.NODE_ENV === "production";
}
