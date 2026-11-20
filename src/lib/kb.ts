import { z } from "zod";

/**
 * 074 (D8) — La base de conocimiento de producción, en puro (sin base): las
 * categorías, el orden con el que llega al cerebro, cómo se aplana a texto,
 * la estimación de tokens y los enlaces verificados.
 */

export const KB_CATEGORIAS = ["general", "servicios", "precios", "horarios", "pagos", "politicas", "faq"] as const;
export type KbCategoria = (typeof KB_CATEGORIAS)[number];

export const ETIQUETA_CATEGORIA: Record<KbCategoria, string> = {
  general: "General",
  servicios: "Servicios",
  precios: "Precios",
  horarios: "Horarios",
  pagos: "Pagos",
  politicas: "Políticas",
  faq: "Preguntas frecuentes",
};

export const kbCategoriaSchema = z.enum(KB_CATEGORIAS);
export const kbTituloSchema = z.string().trim().max(120);

export type KbFila = {
  id?: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
  title?: string | null;
  category?: string | null;
  enabled?: boolean | null;
  pinned?: boolean | null;
  sortOrder?: number | null;
  createdAt?: Date | string | null;
};

const ms = (d: Date | string | null | undefined): number => (d ? new Date(d).getTime() || 0 : 0);

/**
 * El orden canónico (FR-02): solo activas; fijadas primero, luego
 * `sort_order` y luego antigüedad. Estable: a igualdad, el orden de entrada.
 */
export function ordenarKb<T extends KbFila>(filas: T[]): T[] {
  return filas
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.enabled !== false)
    .sort(
      (a, b) =>
        Number(Boolean(b.f.pinned)) - Number(Boolean(a.f.pinned)) ||
        (a.f.sortOrder ?? 0) - (b.f.sortOrder ?? 0) ||
        ms(a.f.createdAt) - ms(b.f.createdAt) ||
        a.i - b.i
    )
    .map(({ f }) => f);
}

/** El título en una línea, sin cabeceras propias que rompan el formato. */
export function tituloLimpio(title: string | null | undefined): string | null {
  const t = (title ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return t || null;
}

/**
 * Texto de UNA entrada. Con título, `## título` encima (E2); sin título,
 * exactamente lo de siempre (las doradas de Nea no cambian).
 */
export function textoDeEntrada(e: KbFila): string {
  const cuerpo = e.kind === "qa" ? (e.question && e.answer ? `P: ${e.question}\nR: ${e.answer}` : "") : (e.content ?? "");
  if (!cuerpo) return "";
  const titulo = tituloLimpio(e.title);
  return titulo ? `## ${titulo}\n${cuerpo}` : cuerpo;
}

export const KB_VACIA = "(knowledge base vacío)";

/**
 * Aplana la KB para el cerebro. Recibe las filas YA ordenadas y filtradas
 * (`ordenarKb` o la consulta de `kbParaElCerebro`); aquí solo se descarta lo
 * apagado por si acaso.
 */
export function renderKb(entries: KbFila[]): string {
  const textos = entries
    .filter((e) => e.enabled !== false)
    .map(textoDeEntrada)
    .filter(Boolean);
  return textos.length === 0 ? KB_VACIA : textos.join("\n\n");
}

// ── Enlaces verificados (`resources`) ──────────────────────────────────────

export const MAX_RECURSOS = 10;

/** `https://`, sin espacios, comillas, ángulos ni corchetes; ≤ 500. */
export function urlDeRecursoValida(url: string): boolean {
  if (url.length > 500 || /[\s"'<>`[\]{}\\]/.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && Boolean(u.hostname) && u.hostname.includes(".") && !u.username && !u.password;
  } catch {
    return false;
  }
}

export const recursoSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .refine((v) => !/[\r\n[\]]/.test(v), { message: "etiqueta_invalida" }),
    url: z.string().trim().refine(urlDeRecursoValida, { message: "url_invalida" }),
  })
  .strict();

export const recursosSchema = z.array(recursoSchema).max(MAX_RECURSOS);
export type Recurso = z.infer<typeof recursoSchema>;

/** Lo guardado, saneado (una fila vieja o editada a mano no rompe el contexto). */
export function recursosGuardados(valor: unknown): Recurso[] {
  if (!Array.isArray(valor)) return [];
  const out: Recurso[] = [];
  for (const v of valor) {
    const r = recursoSchema.safeParse(v);
    if (r.success) out.push(r.data);
    if (out.length >= MAX_RECURSOS) break;
  }
  return out;
}

// ── Presupuesto en tokens (E3) ─────────────────────────────────────────────

/** Presupuesto de la KB + enlaces en el prompt. */
export const PRESUPUESTO_TOKENS_KB = 8_000;
/** Aviso desde el 75 % del presupuesto. */
export const AVISO_TOKENS_KB = 0.75;

/** Estimación sin tokenizer del proveedor: ~4 caracteres por token en español. */
export function estimarTokens(texto: string): number {
  return texto ? Math.ceil(texto.length / 4) : 0;
}

export function textoDeRecursos(recursos: Recurso[]): string {
  return recursos.map((r) => `- «${r.label}»: ${r.url}`).join("\n");
}

export type TamanoKb = {
  chars: number;
  tokens: number;
  budgetTokens: number;
  warnAt: number;
  warning: boolean;
  over: boolean;
};

export function tamanoKb(entradas: KbFila[], recursos: Recurso[]): TamanoKb {
  const activas = ordenarKb(entradas);
  const kb = activas.length ? renderKb(activas) : "";
  const texto = [kb, textoDeRecursos(recursos)].filter(Boolean).join("\n\n");
  const tokens = estimarTokens(texto);
  const warnAt = Math.round(PRESUPUESTO_TOKENS_KB * AVISO_TOKENS_KB);
  return {
    chars: texto.length,
    tokens,
    budgetTokens: PRESUPUESTO_TOKENS_KB,
    warnAt,
    warning: tokens >= warnAt,
    over: tokens > PRESUPUESTO_TOKENS_KB,
  };
}
