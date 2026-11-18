/**
 * Quién puede CONFIGURAR la instancia: conectar el número, pegar la llave de
 * IA, escribir el agente, encenderlo. En la raíz son dos roles: el `owner`
 * que crea la organización en el primer registro y el `admin` que Better Auth
 * conoce (hoy nadie lo asigna, pero es un rol de configuración y no de
 * operación). Un `member` del equipo atiende la Bandeja: no puede hacer
 * ninguno de los pasos de la guía de inicio, así que no se le enseña.
 *
 * Vive en `lib/` porque lo consultan los dos lados: el menú (cliente) y la
 * redirección de la raíz (servidor).
 */
export function canConfigure(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * 069 (D5) — Un acceso de soporte de nivel `configuracion` cuenta como quien
 * configura, SOLO en las rutas que lo declaran (`withAuth` ya cortó el resto).
 * En `lectura`, no configura nada.
 */
export function puedeConfigurar(s: {
  role: string;
  grant?: { level: "lectura" | "configuracion" } | null;
}): boolean {
  if (s.role === "soporte") return s.grant?.level === "configuracion";
  return canConfigure(s.role);
}

/** Igual, pero donde hoy solo vale el dueño (la marca). */
export function esDuenoOSoporteConfig(s: {
  role: string;
  grant?: { level: "lectura" | "configuracion" } | null;
}): boolean {
  if (s.role === "soporte") return s.grant?.level === "configuracion";
  return s.role === "owner";
}
