import { filtrarTexto, unirMarcas } from "./filtrar";
import type { PrivacyPolicy } from "./privacy-filter";

/**
 * 070 (D4) — Ubicaciones y tarjetas de contacto que manda un paciente, por el
 * filtro. Lista blanca: lo que no está aquí se descarta.
 *
 * - `location`: `latitude` y `longitude` (números, tal cual); `name` y
 *   `address` por el filtro. Todo lo demás (`url`…) se va.
 * - `contacts[]`: `name.formatted_name`, `name.first_name` y `phones[].phone`,
 *   por el filtro (un teléfono queda `[telefono]`). Todo lo demás (apellidos,
 *   correos, direcciones, empresa, cumpleaños, `wa_id`…) se va.
 *
 * Un campo con salud queda `[mensaje con información de salud omitido]` y sus
 * marcas se suman a las del mensaje. Sin política, cada texto queda
 * `[mensaje omitido: no se pudo revisar]`; las coordenadas se conservan.
 *
 * Pura: devuelve una copia. La usan `filtrarPayload` (antes de
 * `webhook_event`) y la segunda red de la ingesta.
 */

type Obj = Record<string, unknown>;

const esObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function filtrarUbicacion(
  location: unknown,
  politica: PrivacyPolicy | null,
): { payload: Obj | null; marcas: string[] } {
  if (!esObj(location)) return { payload: null, marcas: [] };
  const marcas: string[][] = [];
  const limpia: Obj = {};
  if (typeof location.latitude === "number")
    limpia.latitude = location.latitude;
  if (typeof location.longitude === "number")
    limpia.longitude = location.longitude;
  for (const campo of ["name", "address"] as const) {
    const valor = location[campo];
    if (typeof valor !== "string" || !valor) continue;
    const r = filtrarTexto(valor, politica);
    limpia[campo] = r.text;
    marcas.push(r.marcas);
  }
  return { payload: limpia, marcas: unirMarcas(...marcas) };
}

export function filtrarTarjetas(
  contacts: unknown,
  politica: PrivacyPolicy | null,
): { payload: Obj[]; marcas: string[] } {
  if (!Array.isArray(contacts)) return { payload: [], marcas: [] };
  const marcas: string[][] = [];
  const texto = (valor: unknown): string | undefined => {
    if (typeof valor !== "string" || !valor) return undefined;
    const r = filtrarTexto(valor, politica);
    marcas.push(r.marcas);
    return r.text;
  };
  const tarjetas: Obj[] = [];
  for (const tarjeta of contacts) {
    if (!esObj(tarjeta)) continue;
    const limpia: Obj = {};
    if (esObj(tarjeta.name)) {
      const nombre: Obj = {};
      const formatted = texto(tarjeta.name.formatted_name);
      const first = texto(tarjeta.name.first_name);
      if (formatted !== undefined) nombre.formatted_name = formatted;
      if (first !== undefined) nombre.first_name = first;
      limpia.name = nombre;
    }
    if (Array.isArray(tarjeta.phones)) {
      const telefonos: Obj[] = [];
      for (const tel of tarjeta.phones) {
        const phone = esObj(tel) ? texto(tel.phone) : undefined;
        if (phone !== undefined) telefonos.push({ phone });
      }
      if (telefonos.length) limpia.phones = telefonos;
    }
    tarjetas.push(limpia);
  }
  return { payload: tarjetas, marcas: unirMarcas(...marcas) };
}

/** Para la segunda red de la ingesta: el `payload` de un `media_asset`. */
export function filtrarAdjuntoEstructurado(
  kind: string,
  payload: unknown,
  politica: PrivacyPolicy | null,
): { payload: unknown; marcas: string[] } {
  if (kind === "location") return filtrarUbicacion(payload, politica);
  if (kind === "contacts") return filtrarTarjetas(payload, politica);
  return { payload, marcas: [] };
}
