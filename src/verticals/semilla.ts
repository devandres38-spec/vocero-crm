import { esPackId, packDe } from "./registro";
import type { SemillaPack } from "./tipos";

/**
 * 072 (D20, FR-021) — La plantilla de un pack lista para aplicar: su semilla
 * de Blueprint + sus campos de ficha + el propio pack. Sin `organization`,
 * `owner`, `brain` ni `region`: eso es de cada negocio. Aplicarla dos veces
 * no cambia nada (conocimiento y respuestas van en `merge`).
 */
export function semillaDe(packId: unknown): SemillaPack {
  const pack = packDe(packId);
  return {
    ...pack.semilla,
    ...(pack.fichaFields.length > 0 ? { fichaFields: { fields: pack.fichaFields.map((f) => ({ ...f })) } } : {}),
    vertical: { pack: esPackId(pack.id) ? pack.id : "default" },
  };
}
