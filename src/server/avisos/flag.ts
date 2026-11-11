/**
 * 071 (3.10, D4 de Aliantis) — Avisos de traspaso por Telegram: un conector
 * OPCIONAL (constitución II, ADR-001). Apagado por defecto; con `AVISOS=on`
 * se avisa cada traspaso al grupo del negocio (`aviso_canal`).
 *
 * Un solo bot de Aliantis: `TELEGRAM_BOT_TOKEN` va en el entorno del
 * despliegue, nunca en el repo ni en la base. `TELEGRAM_API_BASE_URL` existe
 * solo para el mock del self-test.
 */
const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseAvisosFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

export function avisosEncendidos(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseAvisosFlag(env.AVISOS);
}

export const TELEGRAM_API_URL = "https://api.telegram.org";

export function configTelegram(env: NodeJS.ProcessEnv = process.env): {
  token: string | null;
  base: string;
} {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() || null;
  const base = (env.TELEGRAM_API_BASE_URL?.trim() || TELEGRAM_API_URL).replace(
    /\/+$/,
    "",
  );
  return { token, base };
}
