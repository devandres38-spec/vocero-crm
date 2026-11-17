import { dominioBase } from "@/lib/tenancy";

/**
 * Contra DNS rebinding: un Origin presente debe ser de la plataforma —el
 * dominio base, sus subdominios o el origen exacto de APP_BASE_URL (en
 * desarrollo, `http://localhost:3000`)—. Los clientes de escritorio y CLI no
 * mandan Origin. La autenticación es por Bearer, nunca por cookie.
 */
export function origenPermitido(
  origin: string | null,
  source: Record<string, string | undefined> = process.env
): boolean {
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  try {
    if (source.APP_BASE_URL && new URL(source.APP_BASE_URL).origin === url.origin) return true;
  } catch {
    // APP_BASE_URL ilegible: solo cuenta el dominio base.
  }
  const base = dominioBase(source);
  const host = url.hostname;
  return !!base && (host === base || host.endsWith(`.${base}`));
}
