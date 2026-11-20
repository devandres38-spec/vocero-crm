import { z } from "zod";

/**
 * 073-B (D4, D10; decisiones #5, #8 y #10) — Lo que la PLATAFORMA fija del
 * bot de cada negocio, por plan: topes anti-flood, `temperature` y modelo de
 * respaldo. Vive en `organization.metadata.bot` (sin migración) y se edita
 * con la sección `bot` del Blueprint (`/platform`, API, MCP). El cliente no
 * lo ve ni lo cambia.
 */

export type LimitesBot = {
  /** Turnos de IA por conversación en la última hora. */
  perConversationHour: number;
  /** Turnos de IA por conversación en las últimas 24 h. */
  perConversationDay: number;
  /** Turnos de IA de todo el negocio en las últimas 24 h. */
  perOrganizationDay: number;
};

/** Decisión #5: 25/h y 80/día por conversación; 500/día por negocio. */
export const LIMITES_POR_DEFECTO: LimitesBot = {
  perConversationHour: 25,
  perConversationDay: 80,
  perOrganizationDay: 500,
};

/** Decisión #10. */
export const TEMPERATURA_POR_DEFECTO = 0.4;

/** 074 (decisión #9) — Mensajes de «Probar mi agente» por negocio y día. */
export const ENSAYOS_POR_DIA_POR_DEFECTO = 40;

const tope = z.number().int().min(1).max(100_000);

/** Un slug de modelo de OpenRouter (`proveedor/modelo[:variante]`). */
export const MODELO_RE = /^[\w.-]+\/[\w.:-]{1,100}$/;

export const botSeccionSchema = z
  .object({
    limits: z
      .object({
        perConversationHour: tope.optional(),
        perConversationDay: tope.optional(),
        perOrganizationDay: tope.optional(),
      })
      .strict()
      .optional(),
    /** `null` = la de la plataforma (0.4). */
    temperature: z.number().min(0).max(2).nullable().optional(),
    /** `null` = sin respaldo. */
    fallbackModel: z.string().trim().regex(MODELO_RE, { message: "modelo_invalido" }).nullable().optional(),
    /** 074 — Tope diario de «Probar mi agente»; `null` = el de la plataforma (40). */
    playgroundPerDay: z.number().int().min(1).max(10_000).nullable().optional(),
  })
  .strict();

export type BotSeccion = z.infer<typeof botSeccionSchema>;

export type AjustesBot = {
  limits: LimitesBot;
  temperature: number;
  fallbackModel: string | null;
  /** 074 — Mensajes de «Probar mi agente» por día. */
  playgroundPerDay: number;
};

/** Lo guardado en `metadata.bot`, con los defaults de la plataforma. Nunca lanza. */
export function leerAjustesBot(valor: unknown): AjustesBot {
  const r = botSeccionSchema.safeParse(valor ?? {});
  const g = r.success ? r.data : {};
  return {
    limits: { ...LIMITES_POR_DEFECTO, ...(g.limits ?? {}) },
    temperature: g.temperature ?? TEMPERATURA_POR_DEFECTO,
    fallbackModel: g.fallbackModel ?? null,
    playgroundPerDay: g.playgroundPerDay ?? ENSAYOS_POR_DIA_POR_DEFECTO,
  };
}

/** Merge de la sección del Blueprint sobre lo guardado (ausente = no se toca; `null` = quitar). */
export function fusionarBot(actual: unknown, deseado: BotSeccion): BotSeccion {
  const base = botSeccionSchema.safeParse(actual ?? {});
  const out: BotSeccion = base.success ? { ...base.data } : {};
  if (deseado.limits) out.limits = { ...(out.limits ?? {}), ...deseado.limits };
  if (deseado.temperature !== undefined) {
    if (deseado.temperature === null) delete out.temperature;
    else out.temperature = deseado.temperature;
  }
  if (deseado.fallbackModel !== undefined) {
    if (deseado.fallbackModel === null) delete out.fallbackModel;
    else out.fallbackModel = deseado.fallbackModel;
  }
  if (deseado.playgroundPerDay !== undefined) {
    if (deseado.playgroundPerDay === null) delete out.playgroundPerDay;
    else out.playgroundPerDay = deseado.playgroundPerDay;
  }
  return out;
}
