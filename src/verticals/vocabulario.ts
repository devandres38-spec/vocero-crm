import type { Termino, TerminoVocabulario } from "./tipos";

/**
 * 072 (D8) — El vocabulario del núcleo: lo que dice hoy la UI. Un pack o un
 * negocio pisa solo los términos que nombra.
 *
 * Alcance cerrado a propósito: menú, título y estado vacío de Bandeja,
 * Pipeline, Contactos, Citas e Inicio, y el título del panel de la ficha. El
 * resto de la UI conserva su texto: traducir 400 frases a medias es peor que
 * no traducir ninguna.
 */
export const VOCABULARIO_BASE: Record<TerminoVocabulario, Termino> = {
  contacto: { uno: "Contacto", varios: "Contactos" },
  lead: { uno: "Lead", varios: "Leads" },
  pipeline: { uno: "Pipeline", varios: "Pipeline" },
  cita: { uno: "Cita", varios: "Citas" },
  bandeja: { uno: "Bandeja", varios: "Bandeja" },
  ficha: { uno: "Ficha", varios: "Fichas" },
  inicio: { uno: "Inicio", varios: "Inicio" },
  resultados: { uno: "Resultados", varios: "Resultados" },
  agente: { uno: "Agente", varios: "Agentes" },
  etapa: { uno: "Etapa", varios: "Etapas" },
};

export type Vocabulario = Record<TerminoVocabulario, Termino>;

/** `t(voc, "contacto", 2)` → «Pacientes». Sin vocabulario, el del núcleo. */
export function t(
  voc: Partial<Vocabulario> | null | undefined,
  termino: TerminoVocabulario,
  cuantos: "uno" | "varios" = "uno"
): string {
  return (voc?.[termino] ?? VOCABULARIO_BASE[termino])[cuantos];
}
