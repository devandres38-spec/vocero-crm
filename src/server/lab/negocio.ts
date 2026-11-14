import { createHmac } from "node:crypto";
import { z } from "zod";

/**
 * 083 (bloque P2) — Los datos PÚBLICOS del negocio que tiene el cerebro
 * (`POST /vocero/lab/negocio`, spec 021 de `aliantis-brain`): con ellos el
 * Laboratorio arma los guiones de cada negocio y el juez compara contra lo
 * que de verdad dice el bot (D17: el cerebro no lee nuestra base de
 * conocimiento).
 *
 * - URL: el origen de `BRAIN_DISPATCH_URL` + `/vocero/lab/negocio`.
 * - Firma: `sha256=` + HMAC del cuerpo con una llave DERIVADA de
 *   `BOT_API_KEY` y su etiqueta propia (`aliantis:lab:negocio:v1`); el cuerpo
 *   lleva la hora y el negocio.
 * - Espera hasta 3 s. Si algo falla, `null`: el Laboratorio sigue con
 *   guiones neutros.
 */
export const ETIQUETA_LLAVE_LAB = "aliantis:lab:negocio:v1";
const ESPERA_MS = 3000;

const negocioSchema = z.object({
  organizationId: z.string(),
  negocio: z.string().min(1),
  tono: z.enum(["tu", "usted"]),
  filtroSalud: z.boolean(),
  servicios: z.array(
    z.object({
      nombre: z.string().min(1),
      precio: z.string().nullable(),
      precioDesde: z.boolean(),
      duracion: z.string().nullable(),
    })
  ),
  horario: z.string(),
  direccion: z.string(),
  mediosPago: z.array(z.string()),
  preguntasFrecuentes: z.array(z.object({ pregunta: z.string(), respuesta: z.string() })),
});

export type NegocioDelLab = z.infer<typeof negocioSchema>;

export function llaveDelLab(botApiKey: string): string {
  return createHmac("sha256", botApiKey).update(ETIQUETA_LLAVE_LAB).digest("hex");
}

export function firmarLab(cuerpo: string, botApiKey: string): string {
  return `sha256=${createHmac("sha256", llaveDelLab(botApiKey)).update(cuerpo).digest("hex")}`;
}

/** `null` si no hay cerebro configurado (o la URL no se entiende). */
export function urlDelLab(env: Record<string, string | undefined> = process.env): string | null {
  const despacho = env.BRAIN_DISPATCH_URL?.trim();
  if (!despacho || !env.BOT_API_KEY) return null;
  try {
    return new URL("/vocero/lab/negocio", despacho).toString();
  } catch {
    return null;
  }
}

export async function pedirNegocioDelLab(
  organizationId: string,
  deps: {
    env?: Record<string, string | undefined>;
    fetch?: typeof fetch;
    ahora?: () => number;
  } = {}
): Promise<NegocioDelLab | null> {
  const env = deps.env ?? process.env;
  const url = urlDelLab(env);
  if (!url) return null;
  const ahora = (deps.ahora ?? Date.now)();
  const cuerpo = JSON.stringify({ en: new Date(ahora).toISOString(), organizationId });
  try {
    const r = await (deps.fetch ?? fetch)(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vocero-Signature": firmarLab(cuerpo, env.BOT_API_KEY!),
      },
      body: cuerpo,
      redirect: "error",
      signal: AbortSignal.timeout(ESPERA_MS),
    });
    if (!r.ok) return null;
    const leido = negocioSchema.safeParse(await r.json());
    // Otro negocio en la respuesta sería un error del cerebro: no se usa.
    if (!leido.success || leido.data.organizationId !== organizationId) return null;
    return leido.data;
  } catch {
    return null;
  }
}

/** El texto para el juez: lo que el agente sabe del negocio (lo que dice el cerebro). */
export function renderNegocio(n: NegocioDelLab): string {
  const servicios = n.servicios.map((s) => {
    const precio = s.precio === null ? "precio: no configurado (responde una persona)" : `precio: ${s.precioDesde ? "desde " : ""}${s.precio}`;
    const duracion = s.duracion === null ? "duración: no configurada" : `duración: ${s.duracion}`;
    return `- ${s.nombre} (${precio}; ${duracion})`;
  });
  const preguntas = n.preguntasFrecuentes.map((p) => `P: ${p.pregunta}\nR: ${p.respuesta}`);
  return [
    `Negocio: ${n.negocio}`,
    `Servicios:\n${servicios.join("\n")}`,
    `Horario: ${n.horario}`,
    `Dirección: ${n.direccion}`,
    `Medios de pago: ${n.mediosPago.join(", ")}`,
    preguntas.length > 0 ? `Preguntas frecuentes:\n${preguntas.join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
