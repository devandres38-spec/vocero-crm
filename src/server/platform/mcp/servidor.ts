import { auditar } from "@/server/platform/auditoria";
import type { ActorPlataforma } from "@/server/platform/guardia";
import { errorParaIa, herramientas } from "@/server/platform/mcp/herramientas";

/**
 * 069 (D15, R2) — Servidor MCP mínimo, sin estado, sobre JSON-RPC 2.0
 * (transporte Streamable HTTP respondiendo `application/json`).
 *
 * R2: en vez del SDK se usa este manejador propio —el respaldo previsto en
 * el plan—: el subconjunto que necesita un servidor de solo herramientas
 * (`initialize`, `ping`, `tools/list`, `tools/call` y notificaciones) cabe en
 * un archivo, no agrega dependencias al núcleo (constitución II) y no
 * requiere sesiones ni SSE.
 */

export const VERSIONES_PROTOCOLO = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const VERSION_SERVIDOR = "2.9.0";

type Id = string | number | null;
type Mensaje = { jsonrpc?: unknown; id?: Id; method?: unknown; params?: unknown };
export type RespuestaRpc =
  | { jsonrpc: "2.0"; id: Id; result: unknown }
  | { jsonrpc: "2.0"; id: Id; error: { code: number; message: string; data?: unknown } };

const ok = (id: Id, result: unknown): RespuestaRpc => ({ jsonrpc: "2.0", id, result });
const fallo = (id: Id, code: number, message: string, data?: unknown): RespuestaRpc => ({
  jsonrpc: "2.0",
  id,
  error: { code, message, ...(data !== undefined ? { data } : {}) },
});

export const ERRORES_RPC = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

const INSTRUCCIONES =
  "Aprovisiona y configura negocios de una plataforma Aliantis (CRM de WhatsApp). Flujo recomendado: get_catalog → (get_blueprint si el negocio existe) → plan_blueprint → apply_blueprint. El OrganizationBlueprint es declarativo e idempotente. Nunca pongas llaves ni tokens en él: cada negocio conecta sus credenciales. No hay herramientas para leer conversaciones ni contactos.";

/** Procesa UN mensaje. `null` para notificaciones (no llevan respuesta). */
export async function procesarMensaje(actor: ActorPlataforma, m: Mensaje): Promise<RespuestaRpc | null> {
  const id: Id = m.id === undefined ? null : m.id;
  const esNotificacion = m.id === undefined;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") {
    return esNotificacion ? null : fallo(id, ERRORES_RPC.invalidRequest, "Solicitud JSON-RPC inválida");
  }
  if (esNotificacion) return null; // notifications/initialized, cancelled…

  const params = (m.params && typeof m.params === "object" ? m.params : {}) as Record<string, unknown>;
  switch (m.method) {
    case "initialize": {
      const pedida = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const version = (VERSIONES_PROTOCOLO as readonly string[]).includes(pedida) ? pedida : VERSIONES_PROTOCOLO[0];
      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "aliantis-plataforma", title: "Aliantis · Plataforma", version: VERSION_SERVIDOR },
        instructions: INSTRUCCIONES,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: herramientas().map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, ...t.annotations },
        })),
      });
    case "tools/call":
      return llamarHerramienta(actor, id, params);
    default:
      return fallo(id, ERRORES_RPC.methodNotFound, `Método no soportado: ${m.method}`);
  }
}

async function llamarHerramienta(
  actor: ActorPlataforma,
  id: Id,
  params: Record<string, unknown>
): Promise<RespuestaRpc> {
  const nombre = params.name;
  const t = herramientas().find((h) => h.name === nombre);
  if (!t) return fallo(id, ERRORES_RPC.invalidParams, `Herramienta desconocida: ${String(nombre)}`);
  const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<
    string,
    unknown
  >;

  if (!actor.alcances.has(t.scope)) {
    await auditar({
      actorUserId: actor.userId,
      action: "acceso_denegado",
      via: "mcp",
      tokenId: actor.tokenId,
      ip: actor.ip,
      detail: { tool: t.name, motivo: "alcance_insuficiente", requiere: t.scope },
    }).catch(() => undefined);
    return resultadoDeError(id, { code: "alcance_insuficiente", detail: { requiere: t.scope } });
  }

  try {
    const resultado = await t.run(actor, args);
    return ok(id, {
      content: [{ type: "text", text: JSON.stringify(resultado, null, 2) }],
      structuredContent: resultado && typeof resultado === "object" ? resultado : { value: resultado },
      isError: false,
    });
  } catch (err) {
    const e = errorParaIa(err);
    if (e) return resultadoDeError(id, e);
    console.error("[mcp] error no controlado:", err);
    return fallo(id, ERRORES_RPC.internal, "Error interno");
  }
}

/**
 * Un error de negocio va como resultado con `isError` (la IA lo lee y
 * corrige), no como error JSON-RPC (eso es para fallos de protocolo).
 */
function resultadoDeError(id: Id, error: { code: string; issues?: unknown; detail?: unknown }): RespuestaRpc {
  return ok(id, {
    content: [{ type: "text", text: JSON.stringify({ error }, null, 2) }],
    structuredContent: { error },
    isError: true,
  });
}
