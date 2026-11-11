import { createHmac } from "node:crypto";
import { z } from "zod";

/**
 * 076 (D16, respuesta 5 de Andres) — El gasto del LLM por negocio, leído del
 * cerebro (`POST /vocero/gasto`, spec 012 de `aliantis-brain`). Solo
 * agregados: sumas en dólares y conteos.
 *
 * - URL: el origen de `BRAIN_DISPATCH_URL` + `/vocero/gasto` (sin variable nueva).
 * - Firma: `sha256=` + HMAC del cuerpo con una llave DERIVADA de
 *   `BOT_API_KEY` (`HMAC(BOT_API_KEY, "aliantis:panel:gasto:v1")`); el cuerpo
 *   lleva la hora, y el cerebro rechaza una de más de 5 minutos.
 * - Espera hasta 3 s y guarda 60 s. Si algo falla, `null`: el panel dice «no
 *   disponible» y lo demás sigue.
 */
export const ETIQUETA_LLAVE_GASTO = "aliantis:panel:gasto:v1";
const ESPERA_MS = 3000;
const CACHE_MS = 60_000;

const negocio = z.object({
  organizationId: z.string(),
  topeDiarioUsd: z.number().nullable(),
  zonaHoraria: z.string(),
  hoyUsd: z.number(),
  mesUsd: z.number(),
  llamadasHoy: z.number().int(),
  fallidasHoy: z.number().int(),
  pruebasHoyUsd: z.number(),
});
const respuesta = z.object({ en: z.string(), negocios: z.array(negocio) });

export type GastoDeNegocio = z.infer<typeof negocio>;
export type GastoDelCerebro = { en: string; negocios: GastoDeNegocio[] };

export function llaveDelGasto(botApiKey: string): string {
  return createHmac("sha256", botApiKey).update(ETIQUETA_LLAVE_GASTO).digest("hex");
}

export function firmar(cuerpo: string, botApiKey: string): string {
  return `sha256=${createHmac("sha256", llaveDelGasto(botApiKey)).update(cuerpo).digest("hex")}`;
}

/** `null` si no hay cerebro configurado (o la URL no se entiende). */
export function urlDelGasto(env: Record<string, string | undefined> = process.env): string | null {
  const despacho = env.BRAIN_DISPATCH_URL?.trim();
  if (!despacho || !env.BOT_API_KEY) return null;
  try {
    return new URL("/vocero/gasto", despacho).toString();
  } catch {
    return null;
  }
}

type Cache = { hasta: number; valor: Promise<GastoDelCerebro | null> };
const g = globalThis as unknown as { __voceroGastoPanel?: Cache };

export async function pedirGasto(
  deps: {
    env?: Record<string, string | undefined>;
    fetch?: typeof fetch;
    ahora?: () => number;
  } = {}
): Promise<GastoDelCerebro | null> {
  const env = deps.env ?? process.env;
  const url = urlDelGasto(env);
  if (!url) return null;
  const ahora = (deps.ahora ?? Date.now)();
  const cuerpo = JSON.stringify({ en: new Date(ahora).toISOString() });
  try {
    const r = await (deps.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Vocero-Signature": firmar(cuerpo, env.BOT_API_KEY!) },
      body: cuerpo,
      redirect: "error",
      signal: AbortSignal.timeout(ESPERA_MS),
    });
    if (!r.ok) return null;
    const leido = respuesta.safeParse(await r.json());
    return leido.success ? leido.data : null;
  } catch {
    return null;
  }
}

/** Con caché de 60 s, compartida entre peticiones simultáneas. */
export function gastoDelCerebro(): Promise<GastoDelCerebro | null> {
  const ahora = Date.now();
  if (g.__voceroGastoPanel && ahora < g.__voceroGastoPanel.hasta) return g.__voceroGastoPanel.valor;
  const valor = pedirGasto();
  g.__voceroGastoPanel = { hasta: ahora + CACHE_MS, valor };
  // Un fallo no se guarda 60 s: la próxima vez se vuelve a intentar.
  void valor.then((v) => {
    if (v === null && g.__voceroGastoPanel?.valor === valor) g.__voceroGastoPanel = undefined;
  });
  return valor;
}
