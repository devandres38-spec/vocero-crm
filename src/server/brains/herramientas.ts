import { createHash } from "node:crypto";
import { and, eq, lt, or } from "drizzle-orm";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { herramientasDe } from "@/modulos/registro";
import { NOMBRE_HERRAMIENTA_RE, type ModuleTool, type ResultadoHerramienta } from "@/modulos/tipos";
import { IA_PAUSADA } from "@/server/bot/nucleo/acciones";
import type { AmbitoCerebro } from "@/server/brains/auth";
import { VIGENCIA_RESPUESTA_MS } from "@/server/brains/respuestas";
import { leerCuerpoAcotado } from "@/server/brains/http";
import { modulosDeOrganizacion } from "@/server/modulos/consulta";

/**
 * 072-B (D13, D14, FR-042, FR-043) — El puente entre el cerebro y las
 * herramientas de los módulos. Contrato:
 * `specs/072-motor-multi-nicho/contracts/brains-072.md` §3–§4.
 *
 * - `moduleToolsDe`: lo que `/api/brains/context` le anuncia al cerebro.
 * - `ejecutarLlamada`: `POST /api/brains/tools/{name}`.
 *
 * Las dos usan la MISMA selección (`herramientasEfectivas`): no se puede
 * ejecutar lo que no se anunciaría, y los módulos se recalculan en cada
 * llamada (nunca se confía en lo que el cerebro vio antes).
 */

/** Las nativas de Nea + `notas` (contrato §3). Ninguna herramienta de módulo se llama así. */
export const RESERVADOS: readonly string[] = [
  "update_ficha",
  "move_stage",
  "propose_slots",
  "book_session",
  "reschedule_session",
  "list_bookings",
  "cancel_session",
  "coordination_consent",
  "route_out",
  "handoff",
  // 073-B (D6) — La baja que el detector no reconoce (Ley 1581).
  "solicitar_baja",
  "notas",
];

export const TOPE_HERRAMIENTAS = 8;
export const TOPE_ESQUEMA_BYTES = 4096;
export const TOPE_ESQUEMAS_TOTAL_BYTES = 12288;
export const TOPE_CUERPO_BYTES = 16384;
export const TOPE_RESULTADO_BYTES = 4096;
export const TIEMPO_LIMITE_MS = 8000;
/**
 * Una llamada de escritura que quedó «en curso» más de esto (el proceso se
 * cayó a mitad) se puede volver a intentar: el manejador corta a los 8 s.
 */
export const EN_CURSO_VENCIDA_MS = 60_000;

export type ModuleToolAnunciada = {
  name: string;
  module: string;
  effect: "lectura" | "escritura";
  description: string;
  parameters: Record<string, unknown>;
};

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

/** JSON Schema de los argumentos, sin `$schema` (el cerebro no lo necesita). */
export function parametrosDe(tool: ModuleTool): Record<string, unknown> {
  const { $schema: _omitido, ...resto } = z.toJSONSchema(tool.args) as Record<string, unknown>;
  return resto;
}

/** Por qué una herramienta no puede anunciarse, o `null` si puede. */
export function motivoInvalida(modulo: string, tool: ModuleTool): string | null {
  if (!NOMBRE_HERRAMIENTA_RE.test(tool.nombre)) return "nombre_invalido";
  if (!tool.nombre.startsWith(`${modulo}_`)) return "sin_prefijo_del_modulo";
  if (RESERVADOS.includes(tool.nombre)) return "nombre_reservado";
  if (!tool.descripcion.trim() || tool.descripcion.length > 400) return "descripcion_invalida";
  const p = parametrosDe(tool);
  if (p.type !== "object") return "parametros_no_objeto";
  if (bytes(JSON.stringify(p)) > TOPE_ESQUEMA_BYTES) return "esquema_grande";
  return null;
}

type Efectiva = { modulo: string; tool: ModuleTool; anuncio: ModuleToolAnunciada };

/**
 * Las herramientas de los módulos encendidos, en el orden del catálogo, con
 * los topes aplicados (cantidad, esquema y total). Lo que no cabe se omite
 * con un aviso en el log: es un error de código del módulo, no del negocio.
 */
export function herramientasEfectivas(modulos: readonly string[]): Efectiva[] {
  const out: Efectiva[] = [];
  const vistas = new Set<string>();
  let total = 0;
  for (const modulo of modulos) {
    for (const tool of herramientasDe(modulo)) {
      const motivo = motivoInvalida(modulo, tool) ?? (vistas.has(tool.nombre) ? "duplicada" : null);
      if (motivo) {
        console.warn(`[brains] herramienta ${tool.nombre} del módulo ${modulo} omitida: ${motivo}`);
        continue;
      }
      const anuncio: ModuleToolAnunciada = {
        name: tool.nombre,
        module: modulo,
        effect: tool.efecto,
        description: tool.descripcion,
        parameters: parametrosDe(tool),
      };
      const peso = bytes(JSON.stringify(anuncio.parameters));
      if (out.length >= TOPE_HERRAMIENTAS || total + peso > TOPE_ESQUEMAS_TOTAL_BYTES) {
        console.warn(`[brains] herramienta ${tool.nombre} omitida: se pasa del tope por negocio`);
        continue;
      }
      vistas.add(tool.nombre);
      total += peso;
      out.push({ modulo, tool, anuncio });
    }
  }
  return out;
}

/** `moduleTools` del contexto (`[]` = no se manda el campo). */
export async function moduleToolsDe(organizationId: string): Promise<ModuleToolAnunciada[]> {
  const { modules } = await modulosDeOrganizacion(organizationId);
  return herramientasEfectivas(modules).map((e) => e.anuncio);
}

/** JSON con las claves ordenadas a todo nivel: misma entrada, misma cadena. */
export function jsonCanonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * Contrato §4: sha256(conversationId + "\n" + dispatchId + "\n" + name + "\n" + JSON canónico de args).
 *
 * A-1 (auditoría 072-B) — La conversación va en la clave: el mismo
 * `dispatchId` en otra conversación nunca devuelve la respuesta de la primera.
 * B-2 — `args` son los YA validados por el esquema del módulo (`parsed.data`).
 */
export function claveIdempotencia(conversationId: string, dispatchId: string, name: string, args: unknown): string {
  return createHash("sha256")
    .update(`${conversationId}\n${dispatchId}\n${name}\n${jsonCanonico(args)}`)
    .digest("hex");
}

const sobreSchema = z.object({
  conversationId: z.string().min(1).max(128),
  dispatchId: z.string().min(1).max(128),
  args: z.record(z.string(), z.unknown()),
});

const noEncontrada = () => apiError(404, "tool_not_found", "Herramienta no disponible");

type CuerpoOk = { ok: true; result: Record<string, unknown>; estado: "hecho" | "en_curso" };
type CuerpoError = { ok: false; error: string; detalle?: string };

/** Lo que vuelve al cerebro, con el tope de 4 KB. */
export function cuerpoDe(r: ResultadoHerramienta, nombre: string): CuerpoOk | CuerpoError {
  const cuerpo: CuerpoOk | CuerpoError = r.ok
    ? { ok: true, result: r.result, estado: r.estado ?? "hecho" }
    : { ok: false, error: r.error, ...(r.detalle ? { detalle: r.detalle } : {}) };
  if (bytes(JSON.stringify(cuerpo)) > TOPE_RESULTADO_BYTES) {
    console.warn(`[brains] ${nombre}: resultado de más de ${TOPE_RESULTADO_BYTES} bytes, no se devuelve`);
    // B-4 (auditoría 072-B) — Con detalle, para que el modelo no repita la
    // misma llamada esperando otra cosa.
    return {
      ok: false,
      error: "resultado_grande",
      detalle: "el resultado no cabe en la respuesta; no repitas esta llamada con los mismos argumentos",
    };
  }
  return cuerpo;
}

type Opciones = { timeoutMs?: number; ahora?: () => Date };

/** Lo que el puente necesita del ámbito de la credencial (`withBrain`). */
export type AmbitoLlamada = Pick<AmbitoCerebro, "organizationId" | "deploymentId">;

/**
 * `POST /api/brains/tools/{name}` (plan §2.5, pasos 2–8; el 1 es `withBrain`).
 * `organizationId` y `deploymentId` son SIEMPRE los del ámbito de la credencial.
 */
export async function ejecutarLlamada(
  req: Request,
  ambito: AmbitoLlamada,
  nombre: string,
  opciones: Opciones = {}
): Promise<Response> {
  const { organizationId } = ambito;
  const timeoutMs = opciones.timeoutMs ?? TIEMPO_LIMITE_MS;
  const ahora = opciones.ahora ?? (() => new Date());

  // 2. Nombre, tamaño y sobre.
  if (!NOMBRE_HERRAMIENTA_RE.test(nombre)) return noEncontrada();
  const texto = await leerCuerpoAcotado(req, TOPE_CUERPO_BYTES);
  if (texto === null) return apiError(413, "payload_too_large", `El cuerpo pasa de ${TOPE_CUERPO_BYTES} bytes`);
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return apiError(422, "invalid", "El cuerpo no es JSON");
  }
  const sobre = sobreSchema.safeParse(json);
  if (!sobre.success) return apiError(422, "invalid", "Faltan conversationId, dispatchId o args");
  const { conversationId, dispatchId, args } = sobre.data;

  // 3. La herramienta, en un módulo encendido AHORA para este negocio.
  const { modules } = await modulosDeOrganizacion(organizationId);
  const efectiva = herramientasEfectivas(modules).find((e) => e.tool.nombre === nombre);
  if (!efectiva) return noEncontrada();
  const { tool } = efectiva;

  // 4. La conversación es de este negocio y la IA no está en pausa.
  const db = getDb();
  const [conv] = await db
    .select({ aiEnabled: schema.conversation.aiEnabled, handoffAt: schema.conversation.handoffAt })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");
  if (!conv.aiEnabled || conv.handoffAt) return apiError(409, "ai_paused", IA_PAUSADA);

  // 4b. A-1 (auditoría 072-B) — El despacho, con las MISMAS reglas que
  // `POST /api/brains/messages` (`respuestas.ts`): de este negocio y esta
  // conversación, entregado a un cerebro, de las últimas 24 h y entregado a
  // ESTE despliegue. Un cerebro no ejecuta nada en una conversación que nadie
  // le despachó.
  const [despacho] = await db
    .select({
      conversationId: schema.dispatch.conversationId,
      status: schema.dispatch.status,
      createdAt: schema.dispatch.createdAt,
      brainDeploymentId: schema.dispatch.brainDeploymentId,
    })
    .from(schema.dispatch)
    .where(scoped(schema.dispatch.organizationId, organizationId, eq(schema.dispatch.id, dispatchId)))
    .limit(1);
  if (
    !despacho ||
    despacho.conversationId !== conversationId ||
    (despacho.status !== "en_vuelo" && despacho.status !== "entregado") ||
    ahora().getTime() - despacho.createdAt.getTime() > VIGENCIA_RESPUESTA_MS
  ) {
    return apiError(422, "despacho_desconocido", "Ese despacho no existe para esta conversación");
  }
  if (despacho.brainDeploymentId !== ambito.deploymentId) {
    return apiError(409, "cerebro_reasignado", "Este negocio ya lo atiende otro cerebro");
  }

  // 5. Los argumentos contra el esquema del módulo.
  const parsed = tool.args.safeParse(args);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return Response.json(
      {
        error: {
          code: "invalid_args",
          message: issue?.message ?? "Argumentos inválidos",
          details: { path: (issue?.path ?? []).map(String) },
        },
      },
      { status: 422 }
    );
  }

  // 6. Idempotencia de las de escritura.
  let filaId: string | null = null;
  // A-3 (auditoría 072-B) — La marca de la toma: `cerrar()` solo escribe si
  // la fila sigue siendo SUYA (en curso y con esta marca). Una ejecución
  // colgada que alguien ya volvió a tomar no pisa el resultado del reintento.
  let tomadoEn: Date | null = null;
  if (tool.efecto === "escritura") {
    const clave = claveIdempotencia(conversationId, dispatchId, nombre, parsed.data);
    tomadoEn = ahora();
    const [nueva] = await db
      .insert(schema.brainToolCall)
      .values({
        id: newId("brainToolCall"),
        organizationId,
        conversationId,
        dispatchId,
        tool: nombre,
        idempotencyKey: clave,
        estado: "en_curso",
        // B-1 — El reloj de quien decide (el mismo de `vencida` y del fencing).
        createdAt: tomadoEn,
        updatedAt: tomadoEn,
      })
      .onConflictDoNothing({ target: [schema.brainToolCall.organizationId, schema.brainToolCall.idempotencyKey] })
      .returning({ id: schema.brainToolCall.id });
    if (nueva) {
      filaId = nueva.id;
    } else {
      const leer = async () =>
        (
          await db
            .select({
              id: schema.brainToolCall.id,
              conversationId: schema.brainToolCall.conversationId,
              estado: schema.brainToolCall.estado,
              response: schema.brainToolCall.response,
            })
            .from(schema.brainToolCall)
            .where(scoped(schema.brainToolCall.organizationId, organizationId, eq(schema.brainToolCall.idempotencyKey, clave)))
            .limit(1)
        )[0];
      const previa = await leer();
      // A-1 — Defensa: la clave ya incluye la conversación; si aun así la
      // fila es de otra, no se devuelve su respuesta.
      if (previa && previa.conversationId !== conversationId) {
        return apiError(422, "despacho_desconocido", "Ese despacho no existe para esta conversación");
      }
      if (previa?.estado === "hecha" && previa.response) return Response.json(previa.response);
      // Fallida (o «en curso» de un proceso que se cayó): se vuelve a tomar.
      // El `where` condicional hace que, de dos repeticiones simultáneas,
      // solo una ejecute.
      const vencida = new Date(ahora().getTime() - EN_CURSO_VENCIDA_MS);
      const [tomada] = previa
        ? await db
            .update(schema.brainToolCall)
            .set({ estado: "en_curso", updatedAt: tomadoEn })
            .where(
              scoped(
                schema.brainToolCall.organizationId,
                organizationId,
                eq(schema.brainToolCall.id, previa.id),
                or(
                  eq(schema.brainToolCall.estado, "fallida"),
                  and(eq(schema.brainToolCall.estado, "en_curso"), lt(schema.brainToolCall.updatedAt, vencida))
                )
              )
            )
            .returning({ id: schema.brainToolCall.id })
        : [];
      if (!tomada) {
        // A-2 (auditoría 072-B) — Entre la lectura y la toma, la primera pudo
        // terminar: si ya hay respuesta, esa es la que vale.
        const actual = await leer();
        if (actual?.estado === "hecha" && actual.response) return Response.json(actual.response);
        return Response.json({ ok: true, estado: "en_curso", result: {} } satisfies CuerpoOk);
      }
      filaId = tomada.id;
    }
  }

  const cerrar = async (estado: "hecha" | "fallida", response: unknown = null) => {
    if (!filaId || !tomadoEn) return;
    try {
      await db
        .update(schema.brainToolCall)
        .set({ estado, response, updatedAt: ahora() })
        .where(
          scoped(
            schema.brainToolCall.organizationId,
            organizationId,
            eq(schema.brainToolCall.id, filaId),
            // A-3 — Fencing: solo si la fila sigue en la toma de ESTA ejecución.
            eq(schema.brainToolCall.estado, "en_curso"),
            eq(schema.brainToolCall.updatedAt, tomadoEn)
          )
        );
    } catch (err) {
      console.error(`[brains] ${nombre}: no se pudo anotar la llamada —`, err instanceof Error ? err.message : err);
    }
  };

  // 7. Ejecutar con tiempo límite.
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<"tiempo">((resolve) => {
    timer = setTimeout(() => {
      ac.abort();
      resolve("tiempo");
    }, timeoutMs);
  });
  let r: ResultadoHerramienta | "tiempo";
  try {
    r = await Promise.race([
      tool.ejecutar({ organizationId, conversationId, dispatchId, signal: ac.signal }, parsed.data),
      limite,
    ]);
  } catch (err) {
    console.error(`[brains] ${nombre} falló —`, err instanceof Error ? err.message : err);
    await cerrar("fallida");
    return apiError(500, "internal", "Error interno");
  } finally {
    clearTimeout(timer);
  }
  if (r === "tiempo") {
    console.warn(`[brains] ${nombre}: pasó de ${timeoutMs} ms`);
    await cerrar("fallida");
    return apiError(504, "tool_timeout", "La herramienta tardó demasiado");
  }

  // 8. La respuesta, con su tope.
  const cuerpo = cuerpoDe(r, nombre);
  await cerrar("hecha", cuerpo);
  return Response.json(cuerpo);
}
