import { createHmac } from "node:crypto";

/**
 * 073 (D13 de Aliantis; contrato 067, `bot-api-v2.md` §1) — La credencial con
 * la que el cerebro contesta por UN negocio. Es la misma de Vocero Cloud, de
 * Nea (`credencial_derivada`) y de `aliantis-brain` (`src/vocero/credential.ts`):
 * la cadena de dominio y la codificación son contrato entre repositorios. Un
 * byte distinto da 401 en todo; la prueba gemela fija el vector.
 */
export const DOMINIO_CREDENCIAL = "vocero:cerebro:v1";

/** base64url SIN relleno: lo que produce `.digest("base64url")` de Node. */
export function credencialDerivada(secreto: string, organizationId: string): string {
  return createHmac("sha256", secreto)
    .update(`${DOMINIO_CREDENCIAL}:${organizationId}`)
    .digest("base64url");
}
