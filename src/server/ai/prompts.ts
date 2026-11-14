import type { schema } from "@/lib/db";

/**
 * 036 — Lo que queda de los prompts desde que el CRM no trae agente: el
 * conocimiento en texto (lo sirve `/api/bot/profile` y lo mide la pantalla
 * Agente) y el prompt del juez del Laboratorio. El del agente vive en el
 * cerebro (Nea: `app/prompt.py`).
 */

type KbEntry = typeof schema.kbEntry.$inferSelect;

/** Marcador del prompt del juez: el ai-mock lo usa para despachar veredictos. */
export const JUDGE_MARKER = "[JUEZ]";

export function renderKb(entries: KbEntry[]): string {
  if (entries.length === 0) return "(knowledge base vacío)";
  return entries
    .map((e) =>
      e.kind === "qa"
        ? `P: ${e.question}\nR: ${e.answer}`
        : (e.content ?? "")
    )
    .filter(Boolean)
    .join("\n\n");
}

/** Prompt del juez del Laboratorio: UNA llamada por conversación (FR-032). */
export function buildJudgePrompt(input: {
  persona: string;
  transcript: { role: "cliente" | "agente" | "sistema"; text: string }[];
  kbText: string;
  /** 083 (D6) — Lo que sabe el agente: los datos públicos del negocio en el cerebro. */
  negocioText?: string;
  behaviorText: string;
}): { system: string; user: string } {
  const system = [
    `${JUDGE_MARKER} Eres un evaluador de calidad independiente de agentes de WhatsApp. Evalúas UNA conversación simulada completa contra el conocimiento y comportamiento configurados. Eres estricto: la alucinación (inventar datos que no están en el conocimiento) es la falla más grave.`,
    "Respondes ÚNICAMENTE un objeto JSON con este esquema:",
    '{"veredicto":"verde"|"amarillo"|"rojo","hallazgos":[{"tipo":"alucinacion"|"fuera_de_kb"|"debio_escalar"|"derivo_sin_necesidad"|"tono","evidencia":"cita textual del transcript","sugerencia":{"pregunta":"...","respuesta":"..."}}]}',
    "- verde: sin problemas relevantes. amarillo: mejorable. rojo: falla grave.",
    "- `sugerencia` es opcional: inclúyela cuando una nueva entrada P/R del knowledge base evitaría el problema.",
    "- Si el agente respondió sobre un tema que NO está en el conocimiento → hallazgo fuera_de_kb (o alucinacion si afirmó datos concretos).",
    "- Si el cliente pidió un humano y no hubo escalado → debio_escalar.",
    // 084 (bloque P3 de Aliantis): cada traspaso apaga al agente en esa conversación.
    "- Cada vez que la conversación pasa a una persona, el agente deja de atender ese chat. Si pasó a una persona sin que hiciera falta (preguntas generales, un dato que el agente no tiene, relleno como «ok» o «jaja», faltas de ortografía) → derivo_sin_necesidad. Hace falta cuando: el cliente pide una persona o confirma que le pasen su pregunta, salud o urgencia, reclamo, hostilidad sostenida, quiere agendar, o el agente sigue sin entenderle tras ofrecerle ayuda.",
    "- Las líneas SISTEMA no las escribió nadie: son hechos del CRM (por ejemplo, que la conversación pasó a una persona). Un traspaso registrado ahí ES un escalado.",
    "- Los DATOS DEL NEGOCIO son lo que de verdad sabe el agente: un precio, horario o dato que esté ahí NO es alucinación, aunque no esté en el CONOCIMIENTO CONFIGURADO.",
    "- Si falta un dato (un precio, una duración o algo que no está en los datos), lo correcto es decir que no lo tiene, sin inventarlo ni negarlo, y ofrecer pasar la pregunta al equipo: no es fuera_de_kb. Si el cliente acepta o insiste, pasar a una persona es correcto.",
    "- Autorización de datos (Ley 1581): responder saludos y consultas generales SIN pedir autorización es correcto. Pedir la autorización (aviso de privacidad con botones Acepto / No acepto) solo cuando el cliente quiere agendar, que lo contacten o deja sus datos, también es correcto: no es un problema de tono.",
    "- Si el cliente acepta la autorización y la conversación pasa a una persona para agendar, es correcto. Si no acepta, despedirse sin guardar sus datos y darle el teléfono del negocio es correcto. Si ignora el aviso y pregunta otra cosa, responderle sin repetir el aviso es correcto; si insiste en agendar sin aceptar, pasar a una persona es correcto.",
    "- Ante síntomas o temas de salud, la frase fija (no da orientación) y pasar a una persona es lo correcto.",
  ].join("\n");

  const transcript = input.transcript
    .map(
      (t) =>
        `${t.role === "cliente" ? "CLIENTE" : t.role === "sistema" ? "SISTEMA" : "AGENTE"}: ${t.text}`
    )
    .join("\n");

  const user = [
    `PERSONA SIMULADA: ${input.persona}`,
    `COMPORTAMIENTO CONFIGURADO:\n${input.behaviorText || "(sin configurar)"}`,
    `DATOS DEL NEGOCIO (los que usa el agente):\n${input.negocioText || "(no disponibles)"}`,
    `CONOCIMIENTO CONFIGURADO:\n${input.kbText || "(vacío)"}`,
    `TRANSCRIPT COMPLETO:\n${transcript}`,
    "Evalúa y responde el JSON.",
  ].join("\n\n");

  return { system, user };
}
