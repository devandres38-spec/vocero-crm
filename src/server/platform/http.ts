import { BlueprintError } from "@/server/platform/blueprint/errores";

/**
 * 069 (D13) — Respuestas de la API de plataforma: el mismo sobre de error del
 * resto de la API (`{ error: { code, message } }`) más `issues` con la ruta
 * exacta del problema, para que una IA pueda corregir sin adivinar.
 */
export function errorPlataforma(
  status: number,
  code: string,
  message: string = code,
  issues: { path: string; message: string }[] = []
): Response {
  return Response.json(
    { error: { code, message, ...(issues.length ? { issues } : {}) } },
    { status }
  );
}

/** Traduce un error conocido; lo demás es 500 sin detalles. */
export function respuestaDeError(err: unknown): Response {
  if (err instanceof BlueprintError) {
    return errorPlataforma(err.status, err.code, err.code, err.issues);
  }
  console.error("[platform] error no controlado:", err);
  return errorPlataforma(500, "internal", "Error interno");
}

export async function leerJson(
  req: Request
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, data: await req.json() };
  } catch {
    return { ok: false, response: errorPlataforma(422, "invalid_body", "El body debe ser JSON válido") };
  }
}

export function esDryRun(req: Request): boolean {
  const v = new URL(req.url).searchParams.get("dryRun");
  return v === "true" || v === "1";
}
