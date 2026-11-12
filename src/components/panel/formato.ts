/**
 * 076 — Cómo muestra el panel de Andres fechas, números y dinero. Hora de
 * Colombia (donde trabaja Andres), en español.
 */
const ZONA = "America/Bogota";

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CO", { timeZone: ZONA, day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso)
  );
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: ZONA,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** «hace 5 min», «hace 3 h», «hace 2 días». */
export function hace(iso: string | null | undefined, ahora: Date = new Date()): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((ahora.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "hace un momento";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

export function numero(n: number): string {
  return new Intl.NumberFormat("es-CO").format(n);
}

/** Dólares con 2 decimales (o 4 si es menos de un centavo y no es cero). */
export function dolares(n: number): string {
  const decimales = n > 0 && n < 0.01 ? 4 : 2;
  return `US$ ${n.toFixed(decimales)}`;
}

export type Tono = "verde" | "ambar" | "rojo" | "gris";

/** El tono de un gasto frente a su tope: ≥ 100 % rojo, ≥ 80 % ámbar. */
export function tonoDelGasto(gastado: number, tope: number | null): Tono {
  if (tope === null || tope <= 0) return "gris";
  const p = gastado / tope;
  if (p >= 1) return "rojo";
  if (p >= 0.8) return "ambar";
  return "verde";
}

export const ACCIONES: Record<string, string> = {
  alta_negocio: "Alta de negocio",
  pausar: "Pausó el negocio",
  activar: "Activó el negocio",
  restablecer_contrasena: "Restableció una contraseña",
  quitar_usuario: "Quitó una cuenta",
};

export const ROLES: Record<string, string> = {
  owner: "Dueño",
  admin: "Administrador",
  member: "Equipo",
};
