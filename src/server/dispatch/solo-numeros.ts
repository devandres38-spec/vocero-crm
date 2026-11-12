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
