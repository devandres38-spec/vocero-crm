/**
 * 071 (3.10) — El envío a Telegram (`sendMessage`). Adaptado de
 * `aliantis-core/src/notify/telegram-notifier.ts`.
 *
 * Un error NUNCA lleva el token (va en la URL), la URL ni el texto del aviso:
 * solo qué revisar y si vale la pena reintentar.
 */
export const TELEGRAM_TIMEOUT_MS = 10_000;
export const TELEGRAM_TEXTO_MAX = 4096;

export type FalloDeAviso = "token" | "grupo" | "pasajero";

export class AvisoError extends Error {
  readonly tipo: FalloDeAviso;
  readonly status: number;
  constructor(tipo: FalloDeAviso, status: number) {
    super(
      tipo === "token"
        ? "Telegram rechazó el token: revisar TELEGRAM_BOT_TOKEN"
        : tipo === "grupo"
          ? "Telegram no encuentra el grupo: revisar el chat registrado y que el bot siga en él"
          : "Telegram no respondió: se reintenta",
    );
    this.name = "AvisoError";
    this.tipo = tipo;
    this.status = status;
  }
  get reintentable(): boolean {
    return this.tipo === "pasajero";
  }
}

export async function enviarTelegram(
  destino: { base: string; token: string; chatId: string },
  texto: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(`${destino.base}/bot${destino.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: destino.chatId,
        text: texto.slice(0, TELEGRAM_TEXTO_MAX),
        disable_web_page_preview: true,
      }),
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    throw new AvisoError("pasajero", 0);
  } finally {
    clearTimeout(timer);
  }
  await res.body?.cancel().catch(() => {});
  if (res.ok) return;
  if (res.status === 401 || res.status === 404)
    throw new AvisoError("token", res.status);
  if (res.status === 400 || res.status === 403)
    throw new AvisoError("grupo", res.status);
  throw new AvisoError("pasajero", res.status);
}
