import type { FichaValue } from "@/lib/types";

/**
 * M-10 (auditoría 072-A) — Guarda un parche de la ficha y FALLA de verdad si
 * no se guardó (red caída, 4xx/5xx) o si el esquema del negocio descartó algo
 * (`ignored`, A-6): el panel muestra el error en vez de cerrar la edición como
 * si todo hubiera ido bien.
 */
export async function guardarParcheFicha(
  contactId: string,
  patch: Record<string, FichaValue | null>
): Promise<void> {
  const res = await fetch(`/api/contacts/${contactId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ficha: patch }),
  });
  if (!res.ok) throw new Error("No se pudo guardar. Intenta de nuevo.");
  const data = (await res.json().catch(() => null)) as { ignored?: { key: string }[] } | null;
  if (data?.ignored && data.ignored.length > 0) {
    throw new Error("Ese valor no encaja con el tipo del campo; no se guardó.");
  }
}
