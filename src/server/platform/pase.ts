import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, gt, like, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { dominioBase, esPlataforma, raizPlataforma, urlDeNegocio } from "@/lib/tenancy";
import { auditar } from "@/server/platform/auditoria";
import { slugDelHost } from "@/server/tenant/host";
import { esSuperAdmin, grantVigente, membresia, membresiasDe, orgPorId, orgPorSlug } from "@/server/tenant/consultas";
import { organizacionesConSoporteVigente } from "@/server/platform/soporte";

/**
 * 069 (staging) — Pase de sesión entre hosts.
 *
 * Las cookies de sesión son de UN host (sin `crossSubDomainCookies`): así la
 * sesión del Super-Admin en la raíz y la de un dueño en `{slug}.<base>`
 * conviven en el mismo navegador sin pisarse, y funciona en dominios de la
 * Public Suffix List (`*.sslip.io`), que rechazan `Domain=` compartido.
 *
 * Para entrar a un negocio desde la raíz, la raíz emite un pase:
 * - firmado con HMAC-SHA256 y `BETTER_AUTH_SECRET` (con separación de
 *   dominio), con usuario, organización, nonce y vencimiento;
 * - de un solo uso: el nonce vive en `verification` y canjearlo lo BORRA
 *   (`DELETE … RETURNING`): dos canjes del mismo pase, uno falla;
 * - de vida corta: 60 s;
 * - atado al host: solo se canjea en el subdominio de esa organización;
 * - re-verificado al canjear: membresía, o Super-Admin con soporte vigente.
 * El canje (`/api/auth/pase/canjear`, plugin de Better Auth) crea la sesión
 * en ese host y redirige a `/`.
 */

export const PASE_TTL_MS = 60_000;
const DOMINIO_FIRMA = "aliantis-pase:v1:";

export type CargaPase = { u: string; o: string; n: string; e: number };

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function firma(payload: string, secreto: string): string {
  return b64(createHmac("sha256", secreto).update(DOMINIO_FIRMA + payload).digest());
}

/** Pura: el token `payload.firma`. */
export function firmarPase(c: CargaPase, secreto: string): string {
  const payload = b64(JSON.stringify(c));
  return `${payload}.${firma(payload, secreto)}`;
}

/** Pura: la carga si la firma es válida y no venció; si no, null. */
export function leerPase(token: string, secreto: string, ahora: number = Date.now()): CargaPase | null {
  const partes = token.split(".");
  if (partes.length !== 2) return null;
  const [payload, recibida] = partes as [string, string];
  const esperada = Buffer.from(firma(payload, secreto));
  const dada = Buffer.from(recibida);
  if (esperada.length !== dada.length || !timingSafeEqual(esperada, dada)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<CargaPase>;
    if (typeof c.u !== "string" || typeof c.o !== "string" || typeof c.n !== "string" || typeof c.e !== "number") return null;
    if (c.e <= ahora || c.e > ahora + PASE_TTL_MS) return null;
    return c as CargaPase;
  } catch {
    return null;
  }
}

/** Con qué derecho entra alguien a un negocio: miembro, o soporte vigente (solo Super-Admin). */
export async function accesoANegocio(userId: string, organizationId: string): Promise<"miembro" | "soporte" | null> {
  if (await membresia(userId, organizationId)) return "miembro";
  if ((await esSuperAdmin(userId)) && (await grantVigente(userId, organizationId))) return "soporte";
  return null;
}

/**
 * Los negocios en que esta persona puede entrar ya (para los botones del
 * panel), con la misma regla que el pase: miembro de uno activo, o soporte
 * vigente (también en uno suspendido) — F-03.
 */
export async function negociosConAcceso(userId: string): Promise<Set<string>> {
  const [miembro, soporte] = await Promise.all([membresiasDe(userId), organizacionesConSoporteVigente(userId)]);
  const deMiembro = new Set(miembro.map((m) => m.organizationId));
  const puede = new Set<string>();
  for (const m of miembro) if (accesoPermiteEntrar("miembro", m.status)) puede.add(m.organizationId);
  // Un miembro actúa como miembro (como en resolverContexto): su soporte no cuenta.
  for (const o of soporte) if (!deMiembro.has(o)) puede.add(o);
  return puede;
}

/**
 * Pura (auditoría final F-03): ¿ese acceso deja entrar a un negocio en ese
 * estado? Igual que `resolverContexto`: un miembro de un negocio suspendido
 * solo vería «suspendida» (no se le abre sesión para eso); el soporte sí
 * entra a uno suspendido (para ayudar a reactivarlo).
 */
export function accesoPermiteEntrar(acceso: "miembro" | "soporte" | null, status: string): boolean {
  if (acceso === "soporte") return true;
  return acceso === "miembro" && status !== "suspendida";
}

export type ErrorPase = {
  status: 403 | 404;
  code: "sin_acceso" | "organizacion_suspendida" | "organizacion_inexistente" | "sin_dominio";
};

export async function emitirPase(
  userId: string,
  organizationId: string,
  ip?: string | null,
  ahora: number = Date.now()
): Promise<{ ok: true; url: string; expiresAt: string } | { ok: false; error: ErrorPase }> {
  const raiz = raizPlataforma();
  if (!esPlataforma() || !raiz) return { ok: false, error: { status: 404, code: "sin_dominio" } };
  const org = await orgPorId(organizationId);
  if (!org?.slug) return { ok: false, error: { status: 404, code: "organizacion_inexistente" } };
  const acceso = await accesoANegocio(userId, org.id);
  if (!acceso) return { ok: false, error: { status: 403, code: "sin_acceso" } };
  if (!accesoPermiteEntrar(acceso, org.status)) return { ok: false, error: { status: 403, code: "organizacion_suspendida" } };

  // F-04 — Los pases que nadie canjeó (pestaña cerrada) se limpian aquí, de
  // paso: la tabla no crece sin un cron.
  await getDb()
    .delete(schema.verification)
    .where(and(like(schema.verification.identifier, "pase:%"), lt(schema.verification.expiresAt, new Date(ahora))));

  const carga: CargaPase = { u: userId, o: org.id, n: b64(randomBytes(18)), e: ahora + PASE_TTL_MS };
  await getDb()
    .insert(schema.verification)
    .values({
      id: randomUUID(),
      identifier: `pase:${carga.n}`,
      value: `${userId}:${org.id}`,
      expiresAt: new Date(carga.e),
    });
  await auditar({
    actorUserId: userId,
    action: "pase_emitido",
    organizationId: org.id,
    via: "sesion",
    ip,
    detail: { acceso },
  });
  const token = firmarPase(carga, getEnv().BETTER_AUTH_SECRET);
  return {
    ok: true,
    url: urlDeNegocio(raiz, org.slug, `/api/auth/pase/canjear?t=${encodeURIComponent(token)}`),
    expiresAt: new Date(carga.e).toISOString(),
  };
}

export type MotivoCanje = "invalido" | "host_ajeno" | "usado" | "sin_acceso";

export async function canjearPase(
  token: string,
  host: string | null,
  ip?: string | null,
  ahora: number = Date.now()
): Promise<{ ok: true; userId: string; organizationId: string } | { ok: false; motivo: MotivoCanje }> {
  if (!esPlataforma()) return { ok: false, motivo: "invalido" };
  const c = leerPase(token, getEnv().BETTER_AUTH_SECRET, ahora);
  if (!c) return { ok: false, motivo: "invalido" };

  const h = slugDelHost(host, dominioBase());
  const org = h.tipo === "organizacion" ? await orgPorSlug(h.slug) : null;
  if (!org || org.id !== c.o) return { ok: false, motivo: "host_ajeno" };

  // Un solo uso: quien borra la fila canjea; el segundo no encuentra nada.
  const consumidas = await getDb()
    .delete(schema.verification)
    .where(
      and(
        eq(schema.verification.identifier, `pase:${c.n}`),
        eq(schema.verification.value, `${c.u}:${c.o}`),
        gt(schema.verification.expiresAt, new Date(ahora))
      )
    )
    .returning({ id: schema.verification.id });
  if (consumidas.length === 0) return { ok: false, motivo: "usado" };

  // El acceso pudo cerrarse entre emitir y canjear.
  const acceso = await accesoANegocio(c.u, c.o);
  if (!acceso || !accesoPermiteEntrar(acceso, org.status)) return { ok: false, motivo: "sin_acceso" };
  await auditar({
    actorUserId: c.u,
    action: "pase_canjeado",
    organizationId: c.o,
    via: "sesion",
    ip,
    detail: { acceso },
  });
  return { ok: true, userId: c.u, organizationId: c.o };
}
