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

/** Contrato §4: sha256(dispatchId + "\n" + name + "\n" + JSON canónico de args). */
export function claveIdempotencia(dispatchId: string, name: string, args: unknown): string {
  return createHash("sha256").update(`${dispatchId}\n${name}\n${jsonCanonico(args)}`).digest("hex");
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
    return { ok: false, error: "resultado_grande" };
  }
  return cuerpo;
}

type Opciones = { timeoutMs?: number; ahora?: () => Date };

/**
 * `POST /api/brains/tools/{name}` (plan §2.5, pasos 2–8; el 1 es `withBrain`).
 * `organizationId` es SIEMPRE el del ámbito de la credencial.
 */
export async function ejecutarLlamada(
  req: Request,
  organizationId: string,
  nombre: string,
  opciones: Opciones = {}
): Promise<Response> {
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
  if (tool.efecto === "escritura") {
    const clave = claveIdempotencia(dispatchId, nombre, args);
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
      })
      .onConflictDoNothing({ target: [schema.brainToolCall.organizationId, schema.brainToolCall.idempotencyKey] })
      .returning({ id: schema.brainToolCall.id });
    if (nueva) {
      filaId = nueva.id;
    } else {
      const [previa] = await db
        .select({ id: schema.brainToolCall.id, estado: schema.brainToolCall.estado, response: schema.brainToolCall.response })
        .from(schema.brainToolCall)
        .where(scoped(schema.brainToolCall.organizationId, organizationId, eq(schema.brainToolCall.idempotencyKey, clave)))
        .limit(1);
      if (previa?.estado === "hecha" && previa.response) return Response.json(previa.response);
      // Fallida (o «en curso» de un proceso que se cayó): se vuelve a tomar.
      // El `where` condicional hace que, de dos repeticiones simultáneas,
      // solo una ejecute.
      const vencida = new Date(ahora().getTime() - EN_CURSO_VENCIDA_MS);
      const [tomada] = previa
        ? await db
            .update(schema.brainToolCall)
            .set({ estado: "en_curso", updatedAt: ahora() })
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
      if (!tomada) return Response.json({ ok: true, estado: "en_curso", result: {} } satisfies CuerpoOk);
      filaId = tomada.id;
    }
  }

  const cerrar = async (estado: "hecha" | "fallida", response: unknown = null) => {
    if (!filaId) return;
    try {
      await db
        .update(schema.brainToolCall)
        .set({ estado, response, updatedAt: ahora() })
        .where(scoped(schema.brainToolCall.organizationId, organizationId, eq(schema.brainToolCall.id, filaId)));
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
