import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * 080 (P7) — `POST /api/bot/llm/{ruta}` está APAGADO. Con la llave de Aliantis
 * en el entorno, el proxy sería una puerta para gastar sin tope, con cualquier
 * modelo y sin los proveedores fijos (pilares 5 y 1), y nuestro cerebro piensa
 * con su propia llave. Responde 404 `proxy_apagado` sin llamar a nadie; el
 * perfil del cerebro anuncia `llm: null`. Registrado en `decisiones.md`.
 */
export async function POST(): Promise<Response> {
  return apiError(
    404,
    "proxy_apagado",
    "El proxy de IA de Vocero está apagado: el cerebro piensa con su propia llave"
  );
}
