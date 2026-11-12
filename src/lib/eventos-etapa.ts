/**
 * 078 (D18 de Aliantis) — Los eventos con los que el cerebro mueve la etapa
 * del lead. El LLM no elige la etapa: el cerebro emite uno de estos eventos
 * desde el código del turno, y Vocero lo traduce a la etapa que el negocio
 * mapeó (`pipeline_stage.evento_bot`, solo etapas abiertas, una por evento).
 *
 * Lo comparten el servidor (`/api/bot/stage`, `/api/pipeline/stages`) y la
 * pantalla de etapas. El catálogo es el mismo en `aliantis-brain`.
 */
export const EVENTOS_ETAPA = [
  "primera_respuesta",
  "servicio_consultado",
  "pidio_cita",
  "cita_agendada",
] as const;

export type EventoEtapa = (typeof EVENTOS_ETAPA)[number];

export function esEventoEtapa(valor: unknown): valor is EventoEtapa {
  return typeof valor === "string" && (EVENTOS_ETAPA as readonly string[]).includes(valor);
}

/** Lo que ve el dueño en la pantalla de etapas: «El agente mueve aquí al cliente cuando…». */
export const ETIQUETA_EVENTO: Record<EventoEtapa, string> = {
  primera_respuesta: "le responde por primera vez",
  servicio_consultado: "pregunta por un servicio (precio o duración)",
  pidio_cita: "pide una cita o reserva",
  cita_agendada: "queda con una cita agendada (con la agenda)",
};
