import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { esPlataforma } from "@/lib/tenancy";
import { dayIsoInTz } from "@/lib/time/slots";
import { citasEnContexto } from "@/server/agenda/context";
import { getSettings } from "@/server/agenda/settings";
import { ajustesDelNegocio } from "@/server/ajustes-bot";
import { serializeBotProfile } from "@/server/bot/profile";
import { conocimientoDe, llmDelCerebro } from "@/server/brains/context";
import { firmarCuerpo } from "@/server/brains/contract";
import { destinoDe } from "@/server/brains/destino";
import { conversacionDeEnsayo, firmarFichaEnsayo } from "@/server/brains/ensayo-ficha";
import { herramientasEfectivas } from "@/server/brains/herramientas";
import { camposDeHorario } from "@/server/brains/humano";
import { verificarDestino } from "@/server/brains/red";
import { kbParaElCerebro, recursosDe } from "@/server/kb";
import { modulosDeOrganizacion } from "@/server/modulos/consulta";
import { localeDeOrganizacion } from "@/server/region";
import { fichaSchemaDe } from "@/server/ficha/esquema";

/**
 * 074 (D9, decisión #9) — «Probar mi agente».
 *
 * El dueño conversa con SU agente desde Ajustes → Agente. El CRM arma un
 * contexto sintético con la configuración REAL del negocio (perfil, KB activa
 * en orden, enlaces, llm, módulos, horario humano) y se lo manda firmado a
 * `POST /vocero/ensayo` del cerebro asignado, que corre el turno de siempre
 * sobre una memoria que muere con la petición (`nea-agent/app/ensayo.py`).
 *
 * Nada toca la Bandeja: la conversación (`cv_ensayo_*`) y el contacto
 * (`ensayo:*`) no existen en la base, y la ficha de ensayo solo deja pensar
 * y leer huecos (`rutaPermitidaEnEnsayo`). El historial vive en el navegador
 * y viaja en cada mensaje (E5).
 *
 * Tope: `metadata.bot.playgroundPerDay` (40) mensajes por negocio y día de
 * su zona, contados en `agent_playground_day` con un incremento condicionado
 * (dos réplicas no se pasan del tope). Si el cerebro no contesta nada, el
 * cupo se devuelve (E6).
 */

export const MAX_TEXTO_ENSAYO = 2000;
/** Nea acepta hasta 40 mensajes previos (`MAX_HISTORIAL`). */
export const MAX_HISTORIAL_ENSAYO = 40;
/** Nea corta su ensayo a los 120 s (`ENSAYO_TIMEOUT_SECONDS`); el CRM espera un poco más. */
export const TIMEOUT_ENSAYO_MS = 130_000;

export type MensajeEnsayo = { role: "customer" | "agent"; text: string };

// ── Cupo diario (en la base) ───────────────────────────────────────────────

/** Pura: el día del negocio (AAAA-MM-DD en su zona). */
export function diaDelEnsayo(ahora: Date, timezone: string): string {
  return dayIsoInTz(ahora, timezone);
}

/**
 * Toma un cupo si queda. Devuelve cuántos lleva hoy (incluido este) o `null`
 * si ya está en el tope. Atómico: `insert … on conflict do update … where
 * count < tope`.
 */
export async function consumirCupoEnsayo(organizationId: string, dia: string, tope: number): Promise<number | null> {
  const t = schema.agentPlaygroundDay;
  const filas = await getDb()
    .insert(t)
    .values({ organizationId, day: dia, count: 1, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [t.organizationId, t.day],
      set: { count: sql`${t.count} + 1`, updatedAt: new Date() },
      setWhere: sql`${t.count} < ${tope}`,
    })
    .returning({ count: t.count });
  const n = filas[0]?.count;
  return typeof n === "number" && n <= tope ? n : null;
}

/** Devuelve un cupo (el cerebro no contestó nada). Nunca baja de 0. */
export async function devolverCupoEnsayo(organizationId: string, dia: string): Promise<void> {
  const t = schema.agentPlaygroundDay;
  await getDb()
    .update(t)
    .set({ count: sql`greatest(${t.count} - 1, 0)`, updatedAt: new Date() })
    .where(and(eq(t.organizationId, organizationId), eq(t.day, dia)));
}

export async function usadosHoy(organizationId: string, dia: string): Promise<number> {
  const t = schema.agentPlaygroundDay;
  const [f] = await getDb()
    .select({ count: t.count })
    .from(t)
    .where(and(eq(t.organizationId, organizationId), eq(t.day, dia)))
    .limit(1);
  return f?.count ?? 0;
}

// ── A dónde se manda ───────────────────────────────────────────────────────

/** Pura: `…/vocero/dispatch` → `…/vocero/ensayo` (misma Nea, otra ruta). */
export function urlDeEnsayo(dispatchUrl: string): string | null {
  try {
    const u = new URL(dispatchUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (/\/dispatch\/?$/.test(u.pathname)) u.pathname = u.pathname.replace(/\/dispatch\/?$/, "/ensayo");
    else return null;
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

// ── El contexto sintético ──────────────────────────────────────────────────

export async function contextoDeEnsayo(
  organizationId: string,
  conversationId: string,
  ahora: Date = new Date()
): Promise<Record<string, unknown>> {
  const db = getDb();
  const [perfiles, kb, llm, modulos, ajustes, resources, fichaSchema] = await Promise.all([
    db.select().from(schema.agentProfile).where(eq(schema.agentProfile.organizationId, organizationId)).limit(1),
    kbParaElCerebro(organizationId),
    llmDelCerebro(organizationId),
    modulosDeOrganizacion(organizationId),
    ajustesDelNegocio(organizationId),
    recursosDe(organizationId),
    fichaSchemaDe(organizationId),
  ]);
  const perfil = perfiles[0];
  const extra = { coordinationFollowupEnabled: false, agendaEnabled: modulos.agenda };
  const agent = perfil ? { ...serializeBotProfile(perfil, []).profile, ...extra } : extra;
  const moduleTools = herramientasEfectivas(modulos.modules).map((e) => e.anuncio);
  let booking: unknown = null;
  if (modulos.agenda) {
    const [settings, locale] = await Promise.all([getSettings(organizationId), localeDeOrganizacion(organizationId)]);
    // Un cliente de prueba no tiene citas: el bloque va vacío, con la zona.
    booking = citasEnContexto([], settings.timezone, ahora, locale);
  }
  const identidad = `ensayo:${conversationId.slice("cv_ensayo_".length)}`;
  return {
    contact: {
      id: null,
      name: "Cliente de prueba",
      identity: identidad,
      waIdentity: identidad,
      channel: "whatsapp",
      phone: null,
      ficha: {},
    },
    conversation: {
      id: conversationId,
      channel: "whatsapp",
      aiEnabled: true,
      handoffAt: null,
      windowOpen: true,
      windowRemainingMs: 24 * 60 * 60 * 1000,
    },
    lead: null,
    adOrigen: null,
    ...(booking ? { booking } : {}),
    ...(fichaSchema ? { fichaSchema } : {}),
    agent,
    knowledge: conocimientoDe(kb),
    llm: llm ? { ...llm, temperature: ajustes.bot.temperature } : null,
    ...(moduleTools.length > 0 ? { moduleTools } : {}),
    ...camposDeHorario(ajustes),
    ...(resources.length > 0 ? { resources } : {}),
  };
}

// ── El ensayo ──────────────────────────────────────────────────────────────

export type TurnoEnsayo = {
  customer: string;
  replies: string[];
  actions: { type: string; [k: string]: unknown }[];
};

export type ResultadoEnsayo =
  | { ok: true; turn: TurnoEnsayo | null; usados: number; tope: number; aviso: string | null }
  | { ok: false; status: number; code: string; message: string; usados?: number; tope?: number };

/** Pura: lo que el navegador puede ver de un turno del ensayo (sin campos raros ni gigantes). */
export function turnoParaElNavegador(t: unknown): TurnoEnsayo | null {
  if (!t || typeof t !== "object") return null;
  const d = t as { customer?: unknown; replies?: unknown; actions?: unknown };
  const replies = Array.isArray(d.replies)
    ? d.replies.filter((r): r is string => typeof r === "string").map((r) => r.slice(0, 8000)).slice(0, 10)
    : [];
  const actions = Array.isArray(d.actions)
    ? d.actions
        .filter((a): a is { type: string } => Boolean(a) && typeof a === "object" && typeof (a as { type?: unknown }).type === "string")
        .slice(0, 20)
        .map((a) => {
          const limpia: { type: string; [k: string]: unknown } = { type: a.type.slice(0, 60) };
          for (const [k, v] of Object.entries(a)) {
            if (k === "type") continue;
            if (typeof v === "string") limpia[k] = v.slice(0, 500);
            else if (typeof v === "number" || typeof v === "boolean" || v === null) limpia[k] = v;
            else if (k === "fields" && v && typeof v === "object" && !Array.isArray(v)) {
              const campos: Record<string, string | number | boolean | null> = {};
              for (const [ck, cv] of Object.entries(v).slice(0, 20)) {
                campos[ck.slice(0, 60)] =
                  typeof cv === "string" ? cv.slice(0, 200) : typeof cv === "number" || typeof cv === "boolean" ? cv : null;
              }
              limpia[k] = campos;
            }
          }
          return limpia;
        })
    : [];
  return { customer: typeof d.customer === "string" ? d.customer.slice(0, MAX_TEXTO_ENSAYO) : "", replies, actions };
}

const AVISOS: Record<string, string> = {
  tiempo_agotado: "El agente tardó demasiado en contestar.",
  sin_credencial: "Tu agente no tiene con qué pensar: revisa la llave en Ajustes → IA.",
};

export async function ensayar(input: {
  organizationId: string;
  slug: string | null;
  message: string;
  history: MensajeEnsayo[];
  ahora?: Date;
  fetchImpl?: typeof fetch;
}): Promise<ResultadoEnsayo> {
  if (!esPlataforma()) {
    return { ok: false, status: 404, code: "solo_plataforma", message: "«Probar mi agente» existe en el modo plataforma." };
  }
  const ahora = input.ahora ?? new Date();
  const destino = await destinoDe(input.organizationId);
  const url = destino ? urlDeEnsayo(destino.url) : null;
  if (!destino || !url) {
    return { ok: false, status: 409, code: "sin_cerebro", message: "Tu negocio todavía no tiene un agente conectado." };
  }
  if (!(await llmDelCerebro(input.organizationId))) {
    return { ok: false, status: 402, code: "sin_credencial", message: AVISOS.sin_credencial! };
  }
  const problemaDeRed = await verificarDestino(url);
  if (problemaDeRed) {
    return { ok: false, status: 502, code: "cerebro_no_disponible", message: "No se pudo hablar con tu agente." };
  }

  const ajustes = await ajustesDelNegocio(input.organizationId);
  const tope = ajustes.bot.playgroundPerDay;
  const dia = diaDelEnsayo(ahora, ajustes.timezone);
  const usados = await consumirCupoEnsayo(input.organizationId, dia, tope);
  if (usados === null) {
    return {
      ok: false,
      status: 429,
      code: "tope_ensayos",
      message: `Llegaste a las ${tope} pruebas de hoy. Mañana se renuevan.`,
      usados: tope,
      tope,
    };
  }

  const conversationId = conversacionDeEnsayo();
  const evento = {
    type: "rehearsal",
    organization: { id: input.organizationId, slug: input.slug ?? input.organizationId },
    rehearsal: { token: firmarFichaEnsayo(input.organizationId, conversationId, undefined, ahora.getTime()) },
    context: await contextoDeEnsayo(input.organizationId, conversationId, ahora),
    capabilities: [] as string[],
    turns: [input.message],
    history: input.history,
  };
  const cuerpo = JSON.stringify(evento);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_ENSAYO_MS);
  const devolver = async () => {
    await devolverCupoEnsayo(input.organizationId, dia).catch(() => {});
  };
  try {
    const res = await (input.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vocero-signature": firmarCuerpo(cuerpo, destino.secret),
        "x-vocero-organization": input.slug ?? input.organizationId,
      },
      redirect: "manual",
      cache: "no-store",
      body: cuerpo,
      signal: controller.signal,
    });
    if (res.status === 429) {
      await devolver();
      return { ok: false, status: 429, code: "cerebro_ocupado", message: "Tu agente está atendiendo otras pruebas; intenta en un momento." };
    }
    if (!res.ok) {
      await devolver();
      return { ok: false, status: 502, code: "cerebro_no_disponible", message: "Tu agente no pudo correr la prueba." };
    }
    const datos = (await res.json().catch(() => null)) as { ok?: unknown; error?: unknown; turns?: unknown } | null;
    const turns = Array.isArray(datos?.turns) ? datos!.turns : [];
    const turn = turnoParaElNavegador(turns[0]);
    const huboAlgo = Boolean(turn && (turn.replies.length > 0 || turn.actions.length > 0));
    if (!huboAlgo) await devolver();
    if (datos?.ok === false && !huboAlgo) {
      const code = typeof datos.error === "string" ? datos.error : "cerebro_no_disponible";
      return {
        ok: false,
        status: code === "sin_credencial" ? 402 : 502,
        code,
        message: AVISOS[code] ?? "Tu agente no pudo correr la prueba.",
      };
    }
    const aviso = datos?.ok === false && typeof datos.error === "string" ? (AVISOS[datos.error] ?? null) : null;
    return { ok: true, turn, usados: huboAlgo ? usados : usados - 1, tope, aviso };
  } catch {
    await devolver();
    return { ok: false, status: 504, code: "cerebro_sin_respuesta", message: "Tu agente no contestó a tiempo." };
  } finally {
    clearTimeout(timer);
  }
}
