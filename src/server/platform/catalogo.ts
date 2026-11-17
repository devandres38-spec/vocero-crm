import { HERRAMIENTAS, ROLES } from "@/lib/agent-roles";
import { CURRENCY_OPTIONS } from "@/lib/money";
import { blueprintJsonSchema } from "@/lib/platform/blueprint";
import { getRegion } from "@/lib/region";
import { dominioBase, SLUG_REGEX, SLUGS_RESERVADOS } from "@/lib/tenancy";
import { LIMITS } from "@/server/agenda/settings";
import { CATALOGO_VERTICAL, techoDeInstancia } from "@/server/modulos/efectivos";

/**
 * 069 (D13) — Los valores válidos para armar un Blueprint, para que una IA (o
 * un script) no tenga que adivinarlos: roles y herramientas del agente,
 * monedas, módulos que esta instancia permite (el techo), reglas del slug y el
 * JSON Schema del contrato.
 */
export function catalogoPlataforma() {
  const techo = techoDeInstancia();
  const region = getRegion();
  return {
    blueprintVersion: 1,
    baseDomain: dominioBase(),
    regionDefaults: { country: region.country, locale: region.locale, timezone: region.timezone, currency: region.currency },
    slug: { pattern: SLUG_REGEX.source, reserved: [...SLUGS_RESERVADOS].sort(), immutable: true },
    agent: {
      roles: Object.values(ROLES).map((r) => ({ key: r.clave, label: r.etiqueta, description: r.descripcion })),
      tools: HERRAMIENTAS.map((h) => ({ key: h.clave, label: h.etiqueta, requiresAgenda: h.agenda === true, alwaysOn: h.fija === true })),
    },
    currencies: CURRENCY_OPTIONS.map((c) => c.code),
    modules: {
      ceiling: { agenda: techo.agenda, atribucion: techo.atribucion, channels: [...techo.channels] },
      verticals: [...CATALOGO_VERTICAL],
      alwaysOn: ["whatsapp"],
    },
    agenda: { limits: LIMITS, connectors: ["enlace-fijo"], weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
    knowledge: { modes: ["merge", "exact"], maxEntries: 500 },
    schema: blueprintJsonSchema(),
  };
}
