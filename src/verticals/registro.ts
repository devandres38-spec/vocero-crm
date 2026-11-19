import { PACK_CLINICA_SALUD } from "./clinica-salud/pack";
import { PACK_DEFAULT } from "./default/pack";
import { PACK_EVENTOS_MOBILIARIO } from "./eventos-mobiliario/pack";
import { extenderPack } from "./extender";
import type { VerticalPack } from "./tipos";

/**
 * 072 (D3) — El registro de Vertical Packs. Agregar un nicho = un archivo
 * `src/verticals/<id>/pack.ts` + una línea aquí. Nada más del núcleo cambia.
 */
export const PACKS = {
  default: PACK_DEFAULT,
  "clinica-salud": extenderPack(PACK_DEFAULT, PACK_CLINICA_SALUD),
  "eventos-mobiliario": extenderPack(PACK_DEFAULT, PACK_EVENTOS_MOBILIARIO),
} as const satisfies Record<string, VerticalPack>;

export type PackId = keyof typeof PACKS;

export const PACK_IDS = Object.keys(PACKS) as PackId[];

export const PACK_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

export function esPackId(valor: unknown): valor is PackId {
  return typeof valor === "string" && Object.prototype.hasOwnProperty.call(PACKS, valor);
}

/** El pack de un valor guardado; uno desconocido es `default` (nunca un error). */
export function packDe(valor: unknown): VerticalPack {
  return esPackId(valor) ? PACKS[valor] : PACKS.default;
}
