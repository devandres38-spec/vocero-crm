/**
 * Motivos por los que un cerebro externo devuelve la conversación a un humano.
 *
 * El catálogo es cerrado, pero se aplica con FALLBACK, nunca rechazando: un
 * motivo fuera de lista no puede costar el handoff. Un 422 aquí dejaría al bot
 * hablándole a alguien que acaba de pedir una persona — el peor final posible
 * de esa ruta. Del otro lado hay un LLM: tarde o temprano manda "porque se
 * enojó" en vez de "hostilidad".
 */

export const HANDOFF_REASONS = [
  "cliente",
  "modelo",
  "error",
  "ventana",
  "hostilidad",
  // 071 (D10 de Aliantis) — Los motivos que manda aliantis-brain
  // (`src/vocero/motivos.ts`, `MotivoVocero`). `salud` nunca puede caer en `modelo`.
  "salud",
  "reclamo",
  "no_entiende",
  "agendar",
  "tope_gasto",
  "medios",
] as const;

export type HandoffReason = (typeof HANDOFF_REASONS)[number];

export function toHandoffReason(raw: string | undefined | null): HandoffReason {
  const v = raw?.trim().toLowerCase() ?? "";
  return (HANDOFF_REASONS as readonly string[]).includes(v)
    ? (v as HandoffReason)
    : "modelo";
}
