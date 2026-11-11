/**
 * 071 (3.10) — Los textos de los avisos. NUNCA llevan datos del paciente: ni
 * nombre, ni teléfono, ni texto, ni resumen (pilar 4). Solo el nombre del
 * negocio, el motivo y una referencia corta de la conversación para buscarla
 * en la bandeja. Adaptados de `aliantis-core/src/notify/notify-handoffs.ts`.
 */

/** El motivo, en palabras del aviso. Lo desconocido, como «otro motivo». */
export const MOTIVO_DEL_AVISO: Record<string, string> = {
  cliente: "pidió hablar con una persona",
  modelo: "el asistente decidió escalar",
  error: "falla técnica del asistente",
  ventana: "la ventana de 24 h cerró",
  hostilidad: "el cliente se puso agresivo",
  salud: "salud o urgencia",
  reclamo: "reclamo",
  no_entiende: "pregunta que el asistente no sabe responder",
  agendar: "quiere agendar, cambiar o cancelar",
  tope_gasto: "se alcanzó el tope de uso del asistente",
  medios: "envió audios, fotos o archivos",
};

/** Referencia corta de la conversación: con ella se busca en la bandeja. */
export const referencia = (conversationId: string) =>
  conversationId.slice(0, 8);

export function avisoDeTraspaso(datos: {
  negocio: string;
  motivo: string;
  conversationId: string;
  abiertos: number;
}): string {
  const motivo = MOTIVO_DEL_AVISO[datos.motivo] ?? "otro motivo";
  const pendientes =
    datos.abiertos === 1 ? "1 pendiente" : `${datos.abiertos} pendientes`;
  return [
    `${datos.negocio}: nueva derivación (${motivo}).`,
    `Ref. ${referencia(datos.conversationId)} · ${pendientes}. Revisa la bandeja.`,
  ].join("\n");
}

export function avisoDeSeguimiento(datos: {
  negocio: string;
  conversationId: string;
}): string {
  return `${datos.negocio}: la persona de la ref. ${referencia(datos.conversationId)} escribió otra vez.`;
}
