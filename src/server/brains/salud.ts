import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { auditar } from "@/server/platform/auditoria";
import { BlueprintError } from "@/server/platform/blueprint/errores";
import { urlDeSalud, type Actor } from "@/server/brains/deployment";
import { verificarDestino } from "@/server/brains/red";

/**
 * 070 (D13) — «Probar» un despliegue: `GET` a su `/health`.
 *
 * Salvaguardas: lo dispara solo un Super-Admin, la URL ya se validó al
 * guardarla (http(s) sin credenciales), no se siguen redirecciones, 5 s de
 * tope y como mucho 4 KB de cuerpo. Del cuerpo solo se conservan `version`,
 * `mode` y `llm` (lo que Nea publica sin secretos). Se permiten hosts
 * internos (`http://nea:8000`) porque los registra el operador de la
 * plataforma, igual que `BRAIN_DISPATCH_URL` en `single`.
 */

export const TIMEOUT_SALUD_MS = 5000;
export const MAX_CUERPO_SALUD = 4096;

export type ResultadoSalud = {
  ok: boolean;
  status: number | null;
  version: string | null;
  mode: string | null;
  llm: string | null;
  /** `multiorg` es lo que sirve aquí; otro modo es un aviso, no un fallo. */
  multiorg: boolean;
  error: string | null;
};

function texto(v: unknown): string | null {
  return typeof v === "string" && v.length <= 64 ? v : null;
}

/** Pura: interpreta la respuesta de `/health`. */
export function interpretarSalud(status: number, cuerpo: string): ResultadoSalud {
  let datos: Record<string, unknown> = {};
  try {
    const j: unknown = JSON.parse(cuerpo);
    if (j && typeof j === "object" && !Array.isArray(j)) datos = j as Record<string, unknown>;
  } catch {
    // Un /health que no es JSON sigue pudiendo estar sano por el status.
  }
  const mode = texto(datos.mode);
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    version: texto(datos.version),
    mode,
    llm: texto(datos.llm),
    multiorg: mode === "multiorg",
    error: ok ? null : `El cerebro respondió ${status}`,
  };
}

async function leerAcotado(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const lector = res.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await lector.read();
      if (done || !value) break;
      trozos.push(value);
      total += value.byteLength;
    }
  } finally {
    await lector.cancel().catch(() => {});
  }
  const todo = new Uint8Array(Math.min(total, max));
  let off = 0;
  for (const t of trozos) {
    const parte = t.subarray(0, Math.min(t.byteLength, todo.byteLength - off));
    todo.set(parte, off);
    off += parte.byteLength;
    if (off >= todo.byteLength) break;
  }
  return new TextDecoder().decode(todo);
}

/** Llama al `/health` (sin tocar la base). */
export async function consultarSalud(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<ResultadoSalud> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_SALUD_MS);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const cuerpo = await leerAcotado(res, MAX_CUERPO_SALUD);
    return interpretarSalud(res.status, cuerpo);
  } catch {
    return {
      ok: false,
      status: null,
      version: null,
      mode: null,
      llm: null,
      multiorg: false,
      error: controller.signal.aborted
        ? `No contestó en ${TIMEOUT_SALUD_MS / 1000} s`
        : "No se pudo conectar",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Prueba un despliegue, guarda el resultado y lo audita. */
export async function probarDespliegue(
  actor: Actor,
  id: string,
  fetchImpl: typeof fetch = fetch,
  verificar: (url: string) => Promise<string | null> = verificarDestino
): Promise<ResultadoSalud> {
  const [f] = await getDb()
    .select({ dispatchUrl: schema.brainDeployment.dispatchUrl, healthUrl: schema.brainDeployment.healthUrl })
    .from(schema.brainDeployment)
    .where(eq(schema.brainDeployment.id, id))
    .limit(1);
  if (!f) throw new BlueprintError("cerebro_no_encontrado", 404);
  // Auditoría 070 (A-2): el host y sus IPs resueltas, justo antes de conectar.
  const url = urlDeSalud(f);
  const bloqueo = await verificar(url);
  const r: ResultadoSalud = bloqueo
    ? { ok: false, status: null, version: null, mode: null, llm: null, multiorg: false, error: `Destino no permitido (${bloqueo})` }
    : await consultarSalud(url, fetchImpl);
  const detalle = { status: r.status, version: r.version, mode: r.mode, llm: r.llm, error: r.error };
  await getDb().transaction(async (tx) => {
    await tx
      .update(schema.brainDeployment)
      .set({ lastHealthAt: new Date(), lastHealthOk: r.ok, lastHealthDetail: detalle })
      .where(eq(schema.brainDeployment.id, id));
    await auditar(
      {
        actorUserId: actor.userId,
        action: "cerebro_probado",
        via: actor.via,
        tokenId: actor.tokenId,
        ip: actor.ip,
        detail: { deploymentId: id, ok: r.ok, mode: r.mode },
      },
      tx
    );
  });
  return r;
}
