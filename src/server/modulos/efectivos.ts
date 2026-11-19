import { z } from "zod";
import { CHANNEL_ORDER, isChannel, type Channel } from "@/lib/channels";
import { agendaEnabled } from "@/server/agenda/flag";
import { atribucionEnabled } from "@/server/attribution/flag";
import { isChannelEnabled } from "@/server/channels/enabled";
import { CLAVES_MODULO } from "@/modulos/catalogo";

/**
 * 069 (D11) — Módulos por organización. La instancia es el TECHO (lo que el
 * despliegue soporta: `AGENDA`, `ATRIBUCION`, `CHANNELS`) y cada organización
 * enciende o apaga lo suyo dentro de él. Solo la agencia lo cambia (desde
 * `/platform`, Blueprint o MCP), nunca el `owner`.
 *
 * Una organización sin módulos guardados (todas las de `single` y las que
 * existían antes de la 069) hereda el techo: comportamiento 2.8.0.
 */

/**
 * Catálogo de módulos (071+). 072-B (FR-040): se deriva del registro de
 * `src/modulos/catalogo.ts`; una clave que no esté ahí es desconocida.
 */
export const CATALOGO_VERTICAL: readonly string[] = CLAVES_MODULO;

/** WhatsApp no se puede apagar: es el canal por el que existe el producto. */
const CANAL_NUCLEO: Channel = "whatsapp";

export const modulosOrganizacionSchema = z
  .object({
    agenda: z.boolean().optional(),
    atribucion: z.boolean().optional(),
    channels: z
      .array(z.string())
      .refine((cs) => cs.every(isChannel), { message: "canal_desconocido" })
      .refine((cs) => cs.includes(CANAL_NUCLEO), {
        message: "whatsapp_obligatorio",
      })
      .optional(),
    modules: z
      .array(z.string())
      .refine((ms) => ms.every((m) => CATALOGO_VERTICAL.includes(m)), {
        message: "modulo_desconocido",
      })
      .optional(),
  })
  .strict();

export type ModulosOrganizacion = z.infer<typeof modulosOrganizacionSchema>;

export type TechoInstancia = {
  agenda: boolean;
  atribucion: boolean;
  channels: ReadonlySet<Channel>;
};

export type ModulosEfectivos = {
  agenda: boolean;
  atribucion: boolean;
  /** En el orden del catálogo, WhatsApp primero. */
  channels: Channel[];
  modules: string[];
};

/** El techo, con las mismas funciones que la instancia usaba antes de la 069. */
export function techoDeInstancia(): TechoInstancia {
  return {
    agenda: agendaEnabled(),
    atribucion: atribucionEnabled(),
    channels: new Set(CHANNEL_ORDER.filter((c) => isChannelEnabled(c))),
  };
}

/**
 * Techo ∧ organización. Tolera basura en `org` (la columna es JSON): lo que
 * no entiende lo trata como ausente, que es heredar el techo.
 */
export function modulosEfectivos(
  techo: TechoInstancia,
  org: unknown
): ModulosEfectivos {
  const o = (org && typeof org === "object" ? org : {}) as Record<string, unknown>;
  const flag = (v: unknown) => (typeof v === "boolean" ? v : true);
  const pedidos = Array.isArray(o.channels)
    ? new Set(o.channels.filter((c): c is string => typeof c === "string"))
    : null;
  const channels = CHANNEL_ORDER.filter(
    (c) =>
      c === CANAL_NUCLEO || (techo.channels.has(c) && (pedidos === null || pedidos.has(c)))
  );
  const modules = Array.isArray(o.modules)
    ? CATALOGO_VERTICAL.filter((m) => (o.modules as unknown[]).includes(m))
    : [];
  return {
    agenda: techo.agenda && flag(o.agenda),
    atribucion: techo.atribucion && flag(o.atribucion),
    channels,
    modules,
  };
}
