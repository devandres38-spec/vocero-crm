import { notFound, redirect } from "next/navigation";
import { apiError } from "@/lib/api";
import { comoPanel } from "@/lib/db/contexto";
import { estadoDelPanel, type EstadoDelPanel, type Superadmin } from "@/server/panel/guard";

/**
 * 076 (D16) — La puerta de cada ruta y cada página del panel de Andres:
 * `requireSuperadmin` (los 5 pasos de `guard.ts`) y, con eso, todo dentro de
 * `comoPanel` (el rol `vocero_panel`, sin tablas).
 */

/** Las mutaciones solo desde la misma página: el `Origin` debe ser el de la app (o proxy). */
export function mismoOrigen(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origen = req.headers.get("origin");
  if (!origen) return false;
  try {
    const { host: origenHost, origin: origenUrl } = new URL(origen);
    const appBase = process.env.APP_BASE_URL;
    if (appBase) {
      try {
        if (origenUrl === new URL(appBase).origin) return true;
      } catch {
        // APP_BASE_URL malformada no debe tumbar la validación.
      }
    }
    const host =
      req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
      req.headers.get("host") ||
      new URL(req.url).host;
    return Boolean(host) && origenHost === host;
  } catch {
    return false;
  }
}

/** Qué responde una ruta del panel según el guard. `null`: pasa. */
export function respuestaDelGuard(estado: EstadoDelPanel): Response | null {
  switch (estado.tipo) {
    case "ok":
      return null;
    case "no_es":
      // El panel «no existe» para quien no es superadmin.
      return apiError(404, "not_found", "No encontrado");
    case "sin_segundo_factor":
      return apiError(403, "segundo_factor", "Activa el segundo factor antes de usar el panel");
    case "sesion_vieja":
    case "sin_sesion":
      return apiError(401, "unauthorized", "Inicia sesión otra vez");
  }
}

/**
 * Una ruta del panel: guard + mismo origen + `comoPanel`.
 *
 * `{ fueraDelPanel: true }` solo para el alta (`altaDesdeElPanel`):
 * `crearNegocio` entra al negocio nuevo, cosa que desde `comoPanel` no se
 * puede. El guard es el mismo.
 */
export function rutaDelPanel<Args extends unknown[]>(
  handler: (superadmin: Superadmin, req: Request, ...args: Args) => Promise<Response>,
  opciones: { fueraDelPanel?: boolean } = {}
): (req: Request, ...args: Args) => Promise<Response> {
  return async (req: Request, ...args: Args) => {
    const estado = await estadoDelPanel(req.headers);
    const corte = respuestaDelGuard(estado);
    if (corte) return corte;
    if (!mismoOrigen(req)) return apiError(403, "origen", "Origen no permitido");
    const { superadmin } = estado as Extract<EstadoDelPanel, { tipo: "ok" }>;
    try {
      if (opciones.fueraDelPanel) return await handler(superadmin, req, ...args);
      return await comoPanel(superadmin.userId, () => handler(superadmin, req, ...args));
    } catch (err) {
      console.error("[panel] error no controlado:", err instanceof Error ? err.name : "desconocido");
      return apiError(500, "internal", "Error interno");
    }
  };
}

/** A dónde manda una página del panel según el guard. */
export function destinoDeLaPagina(
  estado: EstadoDelPanel,
  { esSegundoFactor = false } = {}
): "pasa" | "/login" | "/admin/segundo-factor" | "/admin" | "/api/admin/salir" | "404" {
  switch (estado.tipo) {
    case "ok":
      return esSegundoFactor ? "/admin" : "pasa";
    case "sin_segundo_factor":
      return esSegundoFactor ? "pasa" : "/admin/segundo-factor";
    case "no_es":
      return "404";
    case "sesion_vieja":
      return "/api/admin/salir";
    case "sin_sesion":
      return "/login";
  }
}

function seguir(destino: ReturnType<typeof destinoDeLaPagina>): void {
  if (destino === "pasa") return;
  if (destino === "404") notFound();
  redirect(destino);
}

/** Una página del panel: guard y, con eso, `comoPanel`. */
export function paginaDelPanel<A extends unknown[], R>(
  pagina: (superadmin: Superadmin, ...props: A) => Promise<R>
): (...props: A) => Promise<R> {
  return async (...props: A) => {
    const estado = await estadoDelPanel();
    seguir(destinoDeLaPagina(estado));
    const { superadmin } = estado as Extract<EstadoDelPanel, { tipo: "ok" }>;
    return comoPanel(superadmin.userId, () => pagina(superadmin, ...props));
  };
}

/** La pantalla para activar el segundo factor: solo para el superadmin que aún no lo tiene. */
export function paginaDelSegundoFactor<A extends unknown[], R>(
  pagina: (superadmin: Superadmin, ...props: A) => Promise<R>
): (...props: A) => Promise<R> {
  return async (...props: A) => {
    const estado = await estadoDelPanel();
    seguir(destinoDeLaPagina(estado, { esSegundoFactor: true }));
    const { superadmin } = estado as Extract<EstadoDelPanel, { tipo: "sin_segundo_factor" }>;
    return pagina(superadmin, ...props);
  };
}
