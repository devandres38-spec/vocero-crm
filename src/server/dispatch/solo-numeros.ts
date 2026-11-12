import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { normalizeMx } from "@/lib/meta/client";

/**
 * 079 (5.5 de Aliantis) — «Solo estos números» (piloto), el reemplazo de
 * `ALLOWED_WA_IDS` de nea-agent. Vive en `agent_profile` y se revisa en las
 * dos puertas del despacho (`encolar.ts` y `worker.ts`), antes del cerebro.
 *
 * - Apagada: todo pasa.
 * - Encendida: pasa solo una identidad que es un teléfono (solo dígitos) y
 *   está en la lista. `ig:`, `fb:`, `tt:` y `bsuid:` no pasan: quedan en la
 *   bandeja para una persona.
 *
 * La excepción de salud (D9) y el Laboratorio (`is_test`) los decide quien
 * llama, no esta regla.
 */
export type ListaDeNumeros = {
  activo: boolean;
  numeros: readonly string[];
};

export const LISTA_APAGADA: ListaDeNumeros = { activo: false, numeros: [] };

/** El motivo con que la puerta de entrega descarta un evento. */
export const MOTIVO_FUERA_DE_LISTA = "fuera de la lista de números";

const SOLO_DIGITOS = /^\d+$/;

export function permitidoPorLista(lista: ListaDeNumeros, identidad: string | null | undefined): boolean {
  if (!lista.activo) return true;
  if (!identidad || !SOLO_DIGITOS.test(identidad)) return false;
  // Los dos lados normalizados: `521…` y `52…` son el mismo número de México.
  const buscado = normalizeMx(identidad);
  return lista.numeros.some((n) => normalizeMx(n) === buscado);
}

/**
 * La lista del negocio, leída al ENTREGAR (pudo cambiar en la ventana de
 * agrupado). No viaja en el evento: el cuerpo es contrato firmado con el
 * cerebro, y los números de otros clientes no son asunto suyo. Sin perfil,
 * apagada.
 */
export async function leerListaDeNumeros(
  organizationId: string,
  db: ReturnType<typeof getDb> = getDb()
): Promise<ListaDeNumeros> {
  const [perfil] = await db
    .select({
      activo: schema.agentProfile.soloNumerosActivo,
      numeros: schema.agentProfile.soloNumeros,
    })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return perfil ? { activo: perfil.activo === true, numeros: perfil.numeros ?? [] } : LISTA_APAGADA;
}

/**
 * Un número pegado a la lista: se limpia lo que trae un teléfono copiado
 * (espacios, `+`, guiones, puntos y paréntesis); después tienen que quedar
 * solo dígitos, con código de país, de 11 a 15, y se aplica `normalizeMx`.
 * `null` si no sirve (letras u otros signos, o largo fuera de rango).
 */
export function normalizarNumeroDeLista(crudo: string): string | null {
  const limpio = crudo.replace(/[\s+\-.()]/g, "");
  if (!/^\d{11,15}$/.test(limpio)) return null;
  return normalizeMx(limpio);
}

export type ListaValidada =
  | { ok: true; lista: { activo: boolean; numeros: string[] } }
  | { ok: false; code: "numero_invalido" | "lista_vacia"; message: string };

/**
 * La lista que llega de la pantalla: cada número limpio y normalizado, sin
 * repetidos (comparados ya normalizados) y sin renglones vacíos. Encenderla
 * vacía no se puede.
 */
export function validarListaDeNumeros(entrada: {
  activo: boolean;
  numeros: readonly string[];
}): ListaValidada {
  const numeros: string[] = [];
  for (const crudo of entrada.numeros) {
    if (!crudo.trim()) continue;
    const n = normalizarNumeroDeLista(crudo);
    if (!n) {
      return {
        ok: false,
        code: "numero_invalido",
        message: `«${crudo.trim()}» no es un número válido: escríbelo con el código de país (11 a 15 dígitos).`,
      };
    }
    if (!numeros.includes(n)) numeros.push(n);
  }
  if (entrada.activo && numeros.length === 0) {
    return {
      ok: false,
      code: "lista_vacia",
      message: "Para encender «Solo estos números» agrega al menos un número.",
    };
  }
  return { ok: true, lista: { activo: entrada.activo, numeros } };
}
