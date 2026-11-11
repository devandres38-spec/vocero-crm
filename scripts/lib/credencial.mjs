/**
 * 073 — La credencial derivada del contrato 067 (`bot-api-v2.md` §1), para los
 * arneses E2E: la misma de `src/server/brains/credencial.ts` y de
 * `aliantis-brain`. Con el id del negocio, las cabeceras del cerebro real;
 * sin él, la `BOT_API_KEY` cruda (compatibilidad con un solo negocio).
 */
import { createHmac } from "node:crypto";

export const credencialDerivada = (secreto, organizationId) =>
  createHmac("sha256", secreto)
    .update(`vocero:cerebro:v1:${organizationId}`)
    .digest("base64url");

export const cabecerasDelCerebro = (secreto, organizationId) =>
  organizationId
    ? {
        "x-vocero-organization": organizationId,
        "x-api-key": credencialDerivada(secreto, organizationId),
      }
    : { "x-api-key": secreto };
