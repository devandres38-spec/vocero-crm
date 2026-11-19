import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { aplicarEsquema, type FichaField, type Ignorado } from "@/lib/ficha-campos";
import { fichaFieldsDe } from "@/server/ficha/esquema";

/**
 * Ficha de calificación del lead: lo que el cerebro externo va descubriendo
 * en la conversación.
 *
 * Las claves NO están cableadas. Cada negocio califica distinto —una clínica
 * pregunta el tratamiento, una constructora los metros, una agencia el
 * presupuesto— y el CRM no tiene por qué migrar cada vez que alguien cambia su
 * cuestionario. Lo que sí impone el CRM es que lo guardado sea sano: escalares,
 * acotados y en número razonable.
 *
 * La validación es FLOJA a propósito. Del otro lado hay un LLM que deriva: hoy
 * manda `dolor_principal` y mañana `dolorPrincipal`, o un `"sí"` donde antes
 * mandaba `true`. Devolverle un 422 le tira datos reales de calificación que ya
 * costaron una conversación; se prefiere guardar lo que se entienda e ignorar
 * en silencio lo que no.
 */

/** Tope de claves por ficha: contiene un bot en bucle sin estorbar a nadie. */
export const MAX_KEYS = 40;
const MAX_KEY_LEN = 60;
const MAX_VALUE_LEN = 500;

export type FichaInput = Record<string, unknown>;
export type Ficha = Record<string, string | number | boolean | null>;

/**
 * Deja la ficha en valores que se puedan guardar y mostrar: escalares
 * acotados. `null` sobrevive porque significa "borra esta clave". Objetos,
 * arreglos y claves absurdas se ignoran sin error.
 */
export function normalizeFicha(raw: FichaInput): Ficha {
  const out: Ficha = {};
  if (!raw || typeof raw !== "object") return out;

  for (const [rawKey, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_KEYS) break;

    const key = rawKey.trim();
    if (!key || key.length > MAX_KEY_LEN) continue;

    if (value === null) {
      out[key] = null;
      continue;
    }
    if (typeof value === "boolean" || typeof value === "number") {
      if (typeof value === "number" && !Number.isFinite(value)) continue;
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      const v = value.trim();
      // La cadena vacía no borra: para eso está `null` explícito. Un LLM manda
      // "" con demasiada facilidad como para dejarlo tirar un dato bueno.
      if (v) out[key] = v.slice(0, MAX_VALUE_LEN);
      continue;
    }
    // Objetos y arreglos: fuera. Se ignoran sin error (ver arriba).
  }
  return out;
}

/**
 * Merge campo a campo: lo ausente se conserva, `null` explícito borra.
 *
 * A-5 (auditoría 072-A) — `MAX_KEYS` acota también la ficha RESULTANTE, no
 * solo cada parche: un bot que manda claves distintas en cada turno ya no
 * la infla sin fin. Borrar y actualizar una clave que ya está siempre pasan,
 * y las del esquema del negocio (`siempre`) también; una clave libre NUEVA
 * con la ficha llena se ignora sin error (la misma regla floja de siempre).
 */
export function mergeFicha(
  prev: Ficha | null | undefined,
  patch: Ficha,
  siempre: ReadonlySet<string> = new Set()
): Ficha {
  const out: Ficha = { ...(prev ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
      continue;
    }
    const nueva = !Object.hasOwn(out, key);
    if (nueva && !siempre.has(key) && Object.keys(out).length >= MAX_KEYS) continue;
    out[key] = value;
  }
  return out;
}

/**
 * A-6 (auditoría 072-A) — El parche listo para el merge. Las claves del
 * esquema se coaccionan desde el valor CRUDO (antes `normalizeFicha` las
 * recortaba o tiraba en silencio y nunca llegaban a `ignored`); el resto pasa
 * por `normalizeFicha` como siempre. Sin esquema, es exactamente
 * `normalizeFicha` (respuesta de 2.11.0).
 */
export function parcheDeFicha(
  raw: FichaInput,
  campos: readonly FichaField[]
): { patch: Ficha; ignored: Ignorado[] } {
  if (campos.length === 0 || !raw || typeof raw !== "object") return { patch: normalizeFicha(raw), ignored: [] };
  const delEsquema = new Set(campos.map((c) => c.key));
  const crudos: Record<string, unknown> = {};
  const libres: FichaInput = {};
  for (const [rawKey, value] of Object.entries(raw)) {
    const key = rawKey.trim();
    if (delEsquema.has(key)) crudos[key] = value;
    else libres[rawKey] = value;
  }
  const { patch: tipado, ignored } = aplicarEsquema(crudos, campos);
  return { patch: { ...normalizeFicha(libres), ...tipado }, ignored };
}

/**
 * Escribe la ficha. Es la ÚNICA puerta: por aquí pasa el cerebro externo
 * (`PUT /api/bot/ficha`) y también el dueño desde la bandeja, así que los dos
 * heredan el mismo merge —`null` borra— y las mismas cotas.
 *
 * Merge y no reemplazo porque los dos escriben a la vez: el bot va llenando
 * mientras conversa y el dueño corrige lo que ve. Con reemplazo, el último en
 * guardar le borraría el trabajo al otro sin que nadie se entere.
 *
 * Devuelve `null` si el contacto no existe en esa organización.
 *
 * 072 (D10) — Si el negocio definió los campos de su ficha, las claves del
 * esquema se guardan tipadas; un valor que no encaja se ignora y vuelve en
 * `ignored` (solo si hubo alguno: sin esquema, la respuesta es la de 2.11.0).
 */
export async function upsertFicha(input: {
  organizationId: string;
  contactId: string;
  ficha: FichaInput;
}): Promise<{ ficha: Ficha; ignored?: Ignorado[] } | null> {
  const db = getDb();
  const campos = await fichaFieldsDe(input.organizationId, db);
  const { patch, ignored } = parcheDeFicha(input.ficha, campos);

  // El acotamiento va aquí y no en cada llamador: una ficha es información de
  // calificación de un cliente ajeno, y confiar en que quien llame se acuerde
  // de filtrar por organización es exactamente como se filtran los datos entre
  // inquilinos.
  const alcance = scoped(
    schema.contact.organizationId,
    input.organizationId,
    eq(schema.contact.id, input.contactId)
  );

  const rows = await db
    .select({ ficha: schema.contact.ficha })
    .from(schema.contact)
    .where(alcance)
    .limit(1);
  if (!rows[0]) return null;

  const merged = mergeFicha(rows[0].ficha as Ficha | null, patch, new Set(campos.map((c) => c.key)));

  await db
    .update(schema.contact)
    .set({ ficha: merged, updatedAt: new Date() })
    .where(alcance);

  return ignored.length > 0 ? { ficha: merged, ignored } : { ficha: merged };
}

/**
 * 026 — Vacía la ficha entera. Solo para cuando se elimina la conversación de
 * la que salió (`server/inbox/eliminar.ts`): la ficha es lo que el agente fue
 * aprendiendo, y viaja al cerebro en cada turno.
 *
 * Recibe el ejecutor para correr DENTRO de la transacción del borrado: vaciar
 * la ficha de un hilo que al final no se borró sería perder datos por nada.
 */
export async function vaciarFicha(
  ejecutor: Pick<ReturnType<typeof getDb>, "update">,
  organizationId: string,
  contactId: string
): Promise<void> {
  await ejecutor
    .update(schema.contact)
    .set({ ficha: null, updatedAt: new Date() })
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.id, contactId)
      )
    );
}

export function serializeFicha(
  contact: typeof schema.contact.$inferSelect
): Ficha {
  return (contact.ficha as Ficha | null) ?? {};
}
