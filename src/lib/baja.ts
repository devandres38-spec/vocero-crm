/**
 * 073-B (D6, decisión #6) — Detector DETERMINISTA de baja (Ley 1581 de 2012).
 *
 * Solo frases inequívocas: una baja falsa le apaga la IA a un cliente que sí
 * quería comprar. Lo dudoso («ya no me interesa», «no me escribas más tarde»)
 * no es baja aquí: lo decide el agente con la herramienta `solicitar_baja`,
 * que puede preguntar.
 */

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[¡!¿?.,;:"'()*_~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** El mensaje entero es una de estas palabras (tras normalizar). */
const PALABRAS_SOLAS = new Set(["stop", "baja", "unsubscribe", "darme de baja", "dar de baja", "cancelar suscripcion"]);

/** Que NO siga algo que la vuelva temporal o condicional. */
const SIN_MATIZ = String.raw`(?!\s+(?:tarde|tardecito|hoy|ahora|ahorita|por\s+(?:hoy|ahora|el\s+momento)|hasta|que|si|de\s+lo|en\s+(?:la|el|estos|esta)|esta\s+semana|este\s+mes|mientras))`;

const FRASES: RegExp[] = [
  // «no me escriban más», «no me vuelvan a escribir», «no me contacten más»
  new RegExp(String.raw`\bno\s+(?:me|nos)\s+(?:escrib|contact|envi|mand)\w*\s+(?:mas|nunca)\b` + SIN_MATIZ),
  new RegExp(String.raw`\bno\s+(?:me|nos)\s+vuelv\w*\s+a\s+(?:escribir|contactar|enviar|mandar)\b` + SIN_MATIZ),
  // «dejen de escribirme», «deja de enviarme mensajes»
  new RegExp(String.raw`\bdej\w*\s+de\s+(?:escribir|contactar|enviar|mandar)(?:me|nos)\b` + SIN_MATIZ),
  // «quiero darme de baja», «denme de baja», «me doy de baja»
  /\b(?:dar(?:me|nos)?|den(?:me|nos)|dame|danos|me\s+doy|nos\s+damos)\s+de\s+baja\b/,
  // «no quiero recibir más mensajes»
  /\bno\s+(?:quiero|deseo|quisiera)\s+recibir\s+mas\s+(?:mensajes|informacion|publicidad|promociones)\b/,
  // «eliminen/borren mis datos»
  /\b(?:elimin|borr|supriman|suprim)\w*\s+mis\s+datos\b/,
];

export function pideBaja(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const t = normalizar(texto);
  if (!t || t.length > 400) return false;
  if (PALABRAS_SOLAS.has(t)) return true;
  return FRASES.some((re) => re.test(t));
}

/** La confirmación fija que recibe el cliente (una sola vez). */
export const CONFIRMACION_BAJA =
  "Entendido: no le enviaremos más mensajes por este medio. Si más adelante quiere retomar, puede escribirnos cuando guste.";

/** La nota interna que ve el equipo. */
export function notaDeBaja(origen: "detector" | "agente" | "operador"): string {
  const quien =
    origen === "operador"
      ? "Una persona del equipo marcó este contacto como baja"
      : "El cliente pidió no recibir más mensajes";
  return (
    `${quien} (Ley 1581). La IA, las plantillas y los seguimientos quedan bloqueados. ` +
    "Puedes contestarle a mano mientras la ventana siga abierta. No se reactiva sola: " +
    "solo con «Reactivar contacto» en esta conversación."
  );
}
