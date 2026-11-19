import type { PackParcial, VerticalPack } from "./tipos";

/**
 * 072 (D3) — La única herencia que existe: `default` → pack. UN nivel.
 *
 * - Objetos (`vocabulario`, `nav.iconos`) se mezclan un nivel: el hijo pisa
 *   lo que nombra y hereda lo demás.
 * - Arreglos (`widgets`, `fichaFields`, `personas`, `nav.orden`,
 *   `nav.ocultas`, `modulosRecomendados`) REEMPLAZAN: mezclar listas por
 *   posición es como nacen los menús que nadie entiende.
 * - `semilla` se mezcla por sección (una sección del hijo reemplaza la de la
 *   base entera; es como se aplica un Blueprint).
 */
export function extenderPack(base: VerticalPack, hijo: PackParcial): VerticalPack {
  return {
    id: hijo.id,
    label: hijo.label,
    description: hijo.description,
    vocabulario: { ...base.vocabulario, ...hijo.vocabulario },
    nav: {
      orden: hijo.nav?.orden ?? base.nav.orden,
      ocultas: hijo.nav?.ocultas ?? base.nav.ocultas,
      iconos: { ...base.nav.iconos, ...hijo.nav?.iconos },
    },
    inicio: hijo.inicio !== undefined ? hijo.inicio : base.inicio,
    fichaFields: hijo.fichaFields ?? base.fichaFields,
    semilla: { ...base.semilla, ...hijo.semilla },
    personas: hijo.personas ?? base.personas,
    modulosRecomendados: hijo.modulosRecomendados ?? base.modulosRecomendados,
  };
}
