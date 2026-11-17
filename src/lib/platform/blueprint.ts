import { z } from "zod";
import { CLAVES_HERRAMIENTA, ROLES, type ClaveHerramienta, type ClaveRol } from "@/lib/agent-roles";
import { isValidHex } from "@/lib/branding";
import { CURRENCIES } from "@/lib/money";
import { esLocale, esPais, esZonaValida } from "@/lib/region";
import { validarSlug } from "@/lib/tenancy";
import { LIMITS } from "@/server/agenda/settings";
import { modulosOrganizacionSchema } from "@/server/modulos/efectivos";

/**
 * 069 (D12, FR-016) — `OrganizationBlueprint` v1: un negocio completo descrito
 * de forma declarativa. Lo consumen el asistente de `/platform`, la API REST
 * `/api/platform/*` y el servidor MCP — el mismo contrato y el mismo servicio
 * (`src/server/platform/blueprint/aplicar.ts`).
 *
 * Reglas del contrato:
 * - Cada sección es opcional; una sección ausente NO se toca.
 * - `.strict()` en cada nivel: un campo desconocido es 422. Así un secreto
 *   (llave de IA, token de WhatsApp) no tiene dónde colarse; además, cualquier
 *   texto con forma de llave se rechaza (`secreto_detectado`).
 * - Los límites son los de las pantallas que editan lo mismo (Ajustes →
 *   Agente, Conocimiento, Pipeline): el Blueprint no permite más que la UI.
 * - No existe `agent.enabled`: encender el agente exige un cerebro sano, y en
 *   modo plataforma el despacho por organización llega en la 070.
 */

const texto = (max: number) => z.string().trim().min(1).max(max);
const textoLargo = (max: number) => z.string().max(max).nullable();

const slugSchema = z.string().superRefine((s, ctx) => {
  const r = validarSlug(s);
  if (!r.ok) ctx.addIssue({ code: "custom", message: `slug_${r.motivo}` });
});

const organizationSchema = z
  .object({
    /** Solo al crear; inmutable después (D8). */
    slug: slugSchema.optional(),
    name: texto(80).optional(),
  })
  .strict();

const regionSchema = z
  .object({
    country: z
      .string()
      .transform((v) => v.trim().toUpperCase())
      .refine(esPais, { message: "pais_invalido" })
      .optional(),
    locale: z.string().trim().refine(esLocale, { message: "locale_invalido" }).optional(),
    timezone: z.string().trim().refine(esZonaValida, { message: "zona_invalida" }).optional(),
  })
  .strict();

const brandSchema = z
  .object({
    name: texto(30).optional(),
    accent: z.string().refine(isValidHex, { message: "color_invalido" }).optional(),
    currency: z.enum(CURRENCIES).optional(),
  })
  .strict();

const normalizarNombre = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const pipelineSchema = z
  .object({
    /** Etapas ABIERTAS, en orden. «Ganado» y «Perdido» son anclas fijas. */
    stages: z
      .array(texto(60))
      .min(1)
      .max(20)
      .refine((xs) => new Set(xs.map(normalizarNombre)).size === xs.length, {
        message: "etapas_repetidas",
      }),
  })
  .strict();

const CLAVES_ROL = Object.keys(ROLES) as [ClaveRol, ...ClaveRol[]];

const agentSchema = z
  .object({
    name: texto(60).optional(),
    tone: textoLargo(500).optional(),
    role: z.enum(CLAVES_ROL).optional(),
    /** `null` = todas las del catálogo (lo de una instalación que actualiza). */
    tools: z
      .array(z.enum(CLAVES_HERRAMIENTA as [ClaveHerramienta, ...ClaveHerramienta[]]))
      .max(CLAVES_HERRAMIENTA.length)
      .nullable()
      .optional(),
    instructions: textoLargo(8000).optional(),
    escalationRules: textoLargo(4000).optional(),
    greeting: textoLargo(1000).optional(),
  })
  .strict();

const entradaSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("qa"),
      question: texto(500),
      answer: texto(4000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("block"),
      content: texto(8000),
    })
    .strict(),
]);

const knowledgeSchema = z
  .object({
    /** `merge`: solo agrega lo que falta. `exact`: además borra lo que sobra. */
    mode: z.enum(["merge", "exact"]).default("merge"),
    entries: z.array(entradaSchema).max(500),
  })
  .strict();

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIAS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const intervaloSchema = z
  .object({ start: z.string().regex(HORA), end: z.string().regex(HORA) })
  .strict()
  .refine((i) => i.start < i.end, { message: "intervalo_invertido" });

/** Los rangos de Ajustes → Agenda: el Blueprint no permite más que la UI. */
const entero = (r: { min: number; max: number }) => z.number().int().min(r.min).max(r.max).optional();

const agendaSchema = z
  .object({
    weeklyHours: z
      .partialRecord(z.enum(DIAS), z.array(intervaloSchema).max(6))
      .refine(
        (semana) =>
          Object.values(semana).every((dia) => {
            const xs = [...(dia ?? [])].sort((a, b) => a.start.localeCompare(b.start));
            return xs.every((x, i) => i === 0 || xs[i - 1]!.end <= x.start);
          }),
        { message: "horarios_solapados" }
      )
      .optional(),
    slotMinutes: entero(LIMITS.slotMinutes),
    bufferMinutes: entero(LIMITS.bufferMinutes),
    minNoticeHours: entero(LIMITS.minNoticeHours),
    maxDaysAhead: entero(LIMITS.maxDaysAhead),
    timezone: z.string().trim().refine(esZonaValida, { message: "zona_invalida" }).optional(),
    /** El único conector sin credenciales; los demás los conecta el negocio. */
    connector: z.literal("enlace-fijo").optional(),
    meetingLink: z.url({ protocol: /^https$/ }).max(500).nullable().optional(),
  })
  .strict();

const ownerSchema = z
  .object({
    email: z
      .string()
      .transform((v) => v.trim().toLowerCase())
      .pipe(z.email()),
    /** Revoca la invitación pendiente y emite un enlace nuevo. */
    regenerate: z.boolean().optional(),
  })
  .strict();

/** Texto con forma de credencial: llaves tipo OpenAI/OpenRouter, tokens de Meta, `alp_`. */
const FORMA_DE_SECRETO = /\b(sk-[A-Za-z0-9_-]{20,}|EAA[A-Za-z0-9]{40,}|alp_[A-Za-z0-9_-]{30,})/;

function buscarSecretos(valor: unknown, ruta: (string | number)[], ctx: z.RefinementCtx): void {
  if (typeof valor === "string") {
    if (FORMA_DE_SECRETO.test(valor)) {
      ctx.addIssue({ code: "custom", path: ruta, message: "secreto_detectado" });
    }
  } else if (Array.isArray(valor)) {
    valor.forEach((v, i) => buscarSecretos(v, [...ruta, i], ctx));
  } else if (valor && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor)) buscarSecretos(v, [...ruta, k], ctx);
  }
}

export const blueprintSchema = z
  .object({
    version: z.literal(1),
    organization: organizationSchema.optional(),
    region: regionSchema.optional(),
    brand: brandSchema.optional(),
    modules: modulosOrganizacionSchema.optional(),
    pipeline: pipelineSchema.optional(),
    agent: agentSchema.optional(),
    knowledge: knowledgeSchema.optional(),
    agenda: agendaSchema.optional(),
    owner: ownerSchema.optional(),
  })
  .strict()
  .superRefine((bp, ctx) => buscarSecretos(bp, [], ctx));

export type OrganizationBlueprint = z.infer<typeof blueprintSchema>;
export type BlueprintEntrada = z.input<typeof blueprintSchema>;

export const SECCIONES_BLUEPRINT = [
  "organization",
  "region",
  "brand",
  "modules",
  "pipeline",
  "agent",
  "knowledge",
  "agenda",
  "owner",
] as const;
export type SeccionBlueprint = (typeof SECCIONES_BLUEPRINT)[number];

export type EstadoSeccion = "creada" | "actualizada" | "sin_cambios";

export type ResultadoBlueprint = {
  organizationId: string;
  slug: string;
  created: boolean;
  dryRun: boolean;
  sections: Partial<Record<SeccionBlueprint, EstadoSeccion>>;
  warnings: string[];
  invitation?:
    | { status: "creada"; url: string; expiresAt: string }
    | { status: "pendiente" | "ya_miembro" | "se_generaria" };
};

/** El JSON Schema del contrato (para el MCP y la OpenAPI). */
export function blueprintJsonSchema(): unknown {
  return z.toJSONSchema(blueprintSchema, { io: "input", unrepresentable: "any" });
}

export { normalizarNombre };
