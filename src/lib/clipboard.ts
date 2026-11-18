/**
 * Auditoría final 069 (F-01) — Copiar al portapapeles, también por HTTP.
 *
 * `navigator.clipboard` solo existe en contextos seguros (HTTPS o
 * localhost): en staging por HTTP (`http://…sslip.io`) o en una red local es
 * `undefined`, y llamar `navigator.clipboard.writeText` lanza un TypeError
 * síncrono. Aquí:
 * 1. Si existe la API moderna, se usa.
 * 2. Si no existe o falla, se copia con un `<textarea>` oculto y
 *    `document.execCommand("copy")` (obsoleto, pero el único camino sin
 *    contexto seguro), restaurando foco y selección.
 * 3. Devuelve `true` SOLO si de verdad copió: la UI dice «Copiado» con
 *    `true` y pide copiar a mano con `false`. Nunca lanza.
 */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  const api = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (api && typeof api.writeText === "function") {
    try {
      await api.writeText(texto);
      return true;
    } catch {
      // Permiso denegado o documento sin foco: se intenta el respaldo.
    }
  }
  return copiarConTextarea(texto);
}

function copiarConTextarea(texto: string): boolean {
  if (typeof document === "undefined" || !document.body || typeof document.execCommand !== "function") return false;
  const area = document.createElement("textarea");
  area.value = texto;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  // Fuera de la vista pero seleccionable; 12pt evita el zoom de iOS al enfocar.
  Object.assign(area.style, { position: "fixed", top: "0", left: "0", opacity: "0", pointerEvents: "none", fontSize: "12pt" });

  const activo =
    typeof HTMLElement !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const seleccion = typeof document.getSelection === "function" ? document.getSelection() : null;
  const rango = seleccion && seleccion.rangeCount > 0 ? seleccion.getRangeAt(0) : null;

  document.body.appendChild(area);
  let ok = false;
  try {
    area.focus();
    area.select();
    area.setSelectionRange(0, texto.length);
    ok = document.execCommand("copy") === true;
  } catch {
    ok = false;
  } finally {
    area.remove();
    if (rango && seleccion) {
      seleccion.removeAllRanges();
      seleccion.addRange(rango);
    }
    activo?.focus();
  }
  return ok;
}

/** El aviso cuando no se pudo copiar (el texto sigue visible en pantalla). */
export const COPIA_MANUAL = "No se pudo copiar: selecciónalo y cópialo a mano.";
