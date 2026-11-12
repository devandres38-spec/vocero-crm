import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { herramientasEfectivas } from "@/lib/agent-roles";
import { upsertFicha, type Ficha } from "@/server/bot/ficha";
import { filtrarTexto } from "@/server/privacy/filtrar";
import { perfilDePrivacidad } from "@/server/privacy/repositorio";

/**
 * 078 (D12 de Aliantis) — Lo que el CEREBRO puede escribir en la ficha: una
 * lista blanca cerrada. Los valores los arma el código del turno (el nombre
 * del servicio del catálogo, un sí a la cita), nunca el texto del paciente ni
 * algo que el LLM escriba libre. El dueño, desde la bandeja, sigue con claves
 * libres (`upsertFicha`).
 *
 * `null` borra la clave, como siempre.
 */
export const FICHA_DEL_CEREBRO = z
  .object({
    /** Nombre del servicio del catálogo (`cliente.yaml`). No se escribe en negocios con filtro de salud. */
    servicio_interes: z.string().trim().min(1).max(80).nullable().optional(),
    /** Pidió una cita o reserva. */
    quiere_cita: z.boolean().nullable().optional(),
  })
  .strict();

export const CLAVES_FICHA_DEL_CEREBRO = Object.keys(FICHA_DEL_CEREBRO.shape);

export type FichaDelCerebro = z.infer<typeof FICHA_DEL_CEREBRO>;

/** La validación del cuerpo: una clave fuera de la lista y un tipo equivocado son errores distintos. */
export function validarFichaDelCerebro(
  raw: unknown
):
  | { ok: true; ficha: FichaDelCerebro }
  | { ok: false; code: "clave_no_permitida" | "invalid_body"; message: string } {
  const r = FICHA_DEL_CEREBRO.safeParse(raw);
  if (r.success) return { ok: true, ficha: r.data };
  const ajenas = r.error.issues.flatMap((i) => (i.code === "unrecognized_keys" ? i.keys : []));
  if (ajenas.length) {
    return {
      ok: false,
      code: "clave_no_permitida",
      message: `El cerebro solo escribe ${CLAVES_FICHA_DEL_CEREBRO.join(" y ")} en la ficha; no: ${ajenas.join(", ")}`,
    };
  }
  return { ok: false, code: "invalid_body", message: z.prettifyError(r.error) };
}

export type ResultadoFicha =
  | { ok: true; ficha: Ficha }
  | { ok: true; prueba: true }
  | { ok: false; status: 404; code: "not_found"; message: string }
  | { ok: false; status: 409; code: "ai_paused" | "herramienta_apagada"; message: string };

/**
 * Escribe lo que mandó el cerebro, con las mismas reglas que la etapa: nunca
 * con una persona atendiendo, solo con la herramienta `ficha` encendida y
 * nunca en el Laboratorio. Un texto que el filtro marca (salud o sin revisar)
 * no se guarda: ni siquiera el marcador.
 */
export async function escribirFichaDelCerebro(input: {
  organizationId: string;
  conversationId: string;
  ficha: FichaDelCerebro;
}): Promise<ResultadoFicha> {
  const db = getDb();
  const { organizationId } = input;
  const [conv] = await db
    .select({
      contactId: schema.conversation.contactId,
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
      isTest: schema.conversation.isTest,
    })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  if (!conv) return { ok: false, status: 404, code: "not_found", message: "Conversación no encontrada" };
  if (conv.isTest) return { ok: true, prueba: true };
  if (!conv.aiEnabled && conv.handoffAt) {
    return { ok: false, status: 409, code: "ai_paused", message: "La IA está en pausa en esta conversación" };
  }
  const [perfil] = await db
    .select({ tools: schema.agentProfile.tools })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  if (!herramientasEfectivas(perfil?.tools).includes("ficha")) {
    return {
      ok: false,
      status: 409,
      code: "herramienta_apagada",
      message: "La herramienta «Llenar la ficha» está apagada en el perfil del agente",
    };
  }

  const politica = await perfilDePrivacidad(organizationId);
  const parche: Record<string, string | boolean | null> = {};
  for (const [clave, valor] of Object.entries(input.ficha)) {
    if (valor === undefined) continue;
    if (typeof valor === "string") {
      const r = filtrarTexto(valor, politica);
      if (r.marcas.includes("salud") || r.marcas.includes("sin_revisar")) continue;
      parche[clave] = r.text;
    } else {
      parche[clave] = valor;
    }
  }

  const res = await upsertFicha({ organizationId, contactId: conv.contactId, ficha: parche });
  if (!res) return { ok: false, status: 404, code: "not_found", message: "Contacto no encontrado" };
  return { ok: true, ficha: res.ficha };
}
