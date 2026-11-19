import type { VerticalPack } from "../tipos";

/**
 * 072 — El pack de todos los negocios que no eligieron nicho, y la base de la
 * que heredan los demás. VACÍO a propósito: un negocio `default` ve
 * exactamente lo de 2.11.0 (red de seguridad en `tests/unit/red-072.test.ts`).
 * El vocabulario base vive en `src/verticals/vocabulario.ts`.
 */
export const PACK_DEFAULT: VerticalPack = {
  id: "default",
  label: "General",
  description: "Para cualquier negocio: bandeja, pipeline y agente sin vocabulario de un nicho.",
  vocabulario: {},
  nav: {},
  inicio: null,
  fichaFields: [],
  semilla: {},
  personas: [],
  modulosRecomendados: [],
};
