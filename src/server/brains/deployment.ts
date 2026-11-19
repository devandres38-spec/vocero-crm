import { createHmac, randomBytes } from "node:crypto";
import { asc, count, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { auditar } from "@/server/platform/auditoria";
import { BlueprintError } from "@/server/platform/blueprint/errores";
import { hostBloqueado } from "@/server/brains/red";

/**
 * 070 — Despliegues de cerebro (una Nea `multiorg` atiende a N negocios).
 *
 * El secreto de un despliegue hace dos cosas, igual que en `nea-agent`
 * (`app/multiorg.py`):
 * 1. firma TODOS los despachos que le llegan, sea cual sea el negocio;
 * 2. deriva la credencial de cada organización para contestar:
 *    `base64url(HMAC-SHA256(secreto, "vocero:cerebro:v1:{organizationId}"))`.
 *
 * Por eso se guarda CIFRADO (AES-256-GCM, `ENCRYPTION_KEY`) y no hasheado:
 * el CRM lo necesita en claro para firmar y derivar. Sale del CRM una sola
 * vez —al crearlo o rotarlo— y nunca por negocio, ni en Blueprint, REST, MCP,
 * logs ni auditoría (FR-004).
 */

/**
 * Separación de dominio. EXACTAMENTE la misma cadena que `DOMINIO` en
 * `nea-agent/app/multiorg.py`: un carácter de diferencia y todo es 401 mudo.
 */
export const DOMINIO_CEREBRO = "vocero:cerebro:v1";

/** Mínimo para un secreto pegado a mano (uno generado aquí mide 43). */
export const MIN_SECRETO = 32;
export const MAX_SECRETO = 256;

/** La credencial de UNA organización dentro de un despliegue. */
export function credencialDerivada(secreto: string, organizationId: string): string {
  return createHmac("sha256", secreto)
    .update(`${DOMINIO_CEREBRO}:${organizationId}`, "utf8")
    .digest("base64url");
}

export function generarSecreto(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Pura: la URL es http(s), sin usuario ni clave, y su host no es loopback,
 * link-local, metadatos de nube ni otra dirección reservada (auditoría 070,
 * A-2; `src/server/brains/red.ts`). `null` si no sirve.
 */
export function urlDeCerebro(raw: string | null | undefined): URL | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (hostBloqueado(u.hostname)) return null;
  return u;
}

export type FalloUrl = { code: "url_invalida" | "url_sin_ruta" | "url_con_query" | "url_otro_origen"; message: string };

/**
 * Auditoría 070 (A-2, A-3) — La URL de DESPACHO: además de `urlDeCerebro`,
 * con ruta (registrar `http://nea:8000` a secas pasaba la validación y la
 * prueba de salud salía verde, pero cada despacho iba a `POST /` → 404) y sin
 * `?query` ni `#fragmento`.
 */
export function revisarUrlDespacho(raw: string): { ok: true; url: URL } | { ok: false; fallo: FalloUrl } {
  const u = urlDeCerebro(raw);
  if (!u) {
    return { ok: false, fallo: { code: "url_invalida", message: "Debe ser una URL http(s) sin usuario ni clave, a un host permitido" } };
  }
  if (u.search || u.hash) {
    return { ok: false, fallo: { code: "url_con_query", message: "La URL de despacho no lleva ?query ni #fragmento" } };
  }
  if (u.pathname === "/" || u.pathname === "") {
    return {
      ok: false,
      fallo: { code: "url_sin_ruta", message: "La URL de despacho debe incluir la ruta, por ejemplo http://nea:8000/vocero/dispatch" },
    };
  }
  return { ok: true, url: u };
}

/** Auditoría 070 (A-2) — La URL de SALUD: válida y del MISMO origen que el despacho. */
export function revisarUrlSalud(raw: string, despacho: string): { ok: true; url: URL } | { ok: false; fallo: FalloUrl } {
  const u = urlDeCerebro(raw);
  if (!u) {
    return { ok: false, fallo: { code: "url_invalida", message: "Debe ser una URL http(s) sin usuario ni clave, a un host permitido" } };
  }
  if (u.origin !== new URL(despacho).origin) {
    return { ok: false, fallo: { code: "url_otro_origen", message: "La URL de salud debe estar en el mismo origen que la de despacho" } };
  }
  return { ok: true, url: u };
}

/** A dónde preguntar si está sano: la explícita o `{origen del despacho}/health`. */
export function urlDeSalud(d: { dispatchUrl: string; healthUrl: string | null }): string {
  if (d.healthUrl) return d.healthUrl;
  return new URL("/health", d.dispatchUrl).toString();
}

export type EstadoDespliegue = "activo" | "pausado";

export type DesplieguePublico = {
  id: string;
  name: string;
  dispatchUrl: string;
  healthUrl: string | null;
  host: string;
  secretLast4: string;
  status: EstadoDespliegue;
  lastHealthAt: string | null;
  lastHealthOk: boolean | null;
  lastHealthDetail: Record<string, unknown> | null;
  organizations: number;
  createdAt: string;
};

type FilaDespliegue = typeof schema.brainDeployment.$inferSelect;

function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Pura: lo que puede salir hacia afuera. Nunca el cifrado ni el secreto. */
export function despliegueVista(f: FilaDespliegue, organizations: number): DesplieguePublico {
  return {
    id: f.id,
    name: f.name,
    dispatchUrl: f.dispatchUrl,
    healthUrl: f.healthUrl,
    host: hostDe(f.dispatchUrl),
    secretLast4: f.secretLast4,
    status: f.status,
    lastHealthAt: f.lastHealthAt?.toISOString() ?? null,
    lastHealthOk: f.lastHealthOk ?? null,
    lastHealthDetail: f.lastHealthDetail ?? null,
    organizations,
    createdAt: f.createdAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ caché */

/**
 * Secreto descifrado por despliegue, ≤ 60 s. `requireBrain` lo pide en cada
 * petición de un cerebro; descifrar cada vez es caro y el secreto casi nunca
 * cambia. Toda escritura de este módulo la invalida en el acto, así que rotar
 * o pausar se nota de inmediato en este proceso.
 */
/**
 * Auditoría 070 (M-1):
 * - TTL de 10 s (antes 60): otros procesos (web y worker, réplicas) no ven la
 *   invalidación de este; es el tope de lo que pueden tardar en enterarse.
 * - `version` (`updated_at`): quien ya leyó la fila del despliegue en su
 *   consulta (`requireBrain`) la pasa, y una entrada con otra versión se
 *   descarta: rotar o pausar se nota en cualquier proceso en la siguiente
 *   petición, no al vencer el TTL.
 * - Época por id: una lectura en vuelo que termine DESPUÉS de una
 *   invalidación no vuelve a guardar el secreto ya revocado.
 */
export const TTL_CACHE_MS = 10_000;
type EnCache = { secreto: string; status: EstadoDespliegue; hasta: number; version: number | null };
const cache = new Map<string, EnCache>();
const epoca = new Map<string, number>();
let epocaGlobal = 0;

const epocaDe = (id: string) => `${epocaGlobal}:${epoca.get(id) ?? 0}`;

export function invalidarCacheCerebro(id?: string): void {
  if (id) {
    cache.delete(id);
    epoca.set(id, (epoca.get(id) ?? 0) + 1);
  } else {
    cache.clear();
    epocaGlobal++;
  }
}

/** El secreto en claro de un despliegue, o `null` si no existe. */
export async function secretoDeDespliegue(
  id: string,
  opts: { version?: Date; ahora?: number } = {}
): Promise<{ secreto: string; status: EstadoDespliegue } | null> {
  const ahora = opts.ahora ?? Date.now();
  const versionPedida = opts.version instanceof Date ? opts.version.getTime() : null;
  const c = cache.get(id);
  if (c && c.hasta > ahora && (versionPedida === null || c.version === versionPedida)) {
    return { secreto: c.secreto, status: c.status };
  }
  const epocaAntes = epocaDe(id);
  const [f] = await getDb()
    .select({
      cipher: schema.brainDeployment.secretCipher,
      iv: schema.brainDeployment.secretIv,
      tag: schema.brainDeployment.secretTag,
      status: schema.brainDeployment.status,
      updatedAt: schema.brainDeployment.updatedAt,
    })
    .from(schema.brainDeployment)
    .where(eq(schema.brainDeployment.id, id))
    .limit(1);
  if (!f) {
    cache.delete(id);
    return null;
  }
  const secreto = decryptSecret({ cipher: f.cipher, iv: f.iv, tag: f.tag });
  // Solo se guarda si nadie invalidó mientras se leía.
  if (epocaDe(id) === epocaAntes) {
    cache.set(id, {
      secreto,
      status: f.status,
      hasta: ahora + TTL_CACHE_MS,
      version: f.updatedAt instanceof Date ? f.updatedAt.getTime() : null,
    });
  }
  return { secreto, status: f.status };
}

/* --------------------------------------------------------------- servicio */

export type Actor = { userId: string; ip?: string | null; via?: "sesion" | "api" | "mcp"; tokenId?: string | null };

function errorUrl(path: string, fallo?: FalloUrl): BlueprintError {
  return new BlueprintError(fallo?.code ?? "url_invalida", 422, [
    { path, message: fallo?.message ?? "Debe ser una URL http(s) sin usuario ni clave" },
  ]);
}

function secretoValido(secret: string): boolean {
  return secret.length >= MIN_SECRETO && secret.length <= MAX_SECRETO && !/\s/.test(secret);
}

function cifrar(secret: string) {
  const e = encryptSecret(secret);
  return { secretCipher: e.cipher, secretIv: e.iv, secretTag: e.tag, secretLast4: secret.slice(-4) };
}

async function contarNegocios(): Promise<Map<string, number>> {
  const filas = await getDb()
    .select({ id: schema.organization.brainDeploymentId, n: count() })
    .from(schema.organization)
    .where(isNotNull(schema.organization.brainDeploymentId))
    .groupBy(schema.organization.brainDeploymentId);
  return new Map(filas.filter((f) => f.id).map((f) => [f.id as string, Number(f.n)]));
}

export async function listarDespliegues(): Promise<DesplieguePublico[]> {
  const [filas, conteo] = await Promise.all([
    getDb().select().from(schema.brainDeployment).orderBy(asc(schema.brainDeployment.createdAt)),
    contarNegocios(),
  ]);
  return filas.map((f) => despliegueVista(f, conteo.get(f.id) ?? 0));
}

async function filaDe(id: string): Promise<FilaDespliegue> {
  const [f] = await getDb()
    .select()
    .from(schema.brainDeployment)
    .where(eq(schema.brainDeployment.id, id))
    .limit(1);
  if (!f) throw new BlueprintError("cerebro_no_encontrado", 404);
  return f;
}

export async function obtenerDespliegue(id: string): Promise<DesplieguePublico> {
  const f = await filaDe(id);
  const conteo = await contarNegocios();
  return despliegueVista(f, conteo.get(f.id) ?? 0);
}

export type EntradaDespliegue = {
  name: string;
  dispatchUrl: string;
  healthUrl?: string | null;
  /** Pegar el de una Nea ya desplegada; sin él se genera uno. */
  secret?: string | null;
};

/** Crea el despliegue. El secreto se devuelve UNA vez. */
export async function crearDespliegue(
  actor: Actor,
  input: EntradaDespliegue
): Promise<{ secret: string; despliegue: DesplieguePublico }> {
  const rd = revisarUrlDespacho(input.dispatchUrl);
  if (!rd.ok) throw errorUrl("dispatchUrl", rd.fallo);
  const despacho = rd.url;
  let salud: URL | null = null;
  if (input.healthUrl) {
    const rs = revisarUrlSalud(input.healthUrl, despacho.toString());
    if (!rs.ok) throw errorUrl("healthUrl", rs.fallo);
    salud = rs.url;
  }
  const secret = input.secret?.trim() || generarSecreto();
  if (!secretoValido(secret)) {
    throw new BlueprintError("secreto_invalido", 422, [
      { path: "secret", message: `Mínimo ${MIN_SECRETO} caracteres, sin espacios` },
    ]);
  }
  const id = newId("brainDeployment");
  const ahora = new Date();
  const fila = {
    id,
    name: input.name.trim(),
    dispatchUrl: despacho.toString(),
    healthUrl: salud?.toString() ?? null,
    ...cifrar(secret),
    status: "activo" as const,
    createdBy: actor.userId,
    createdAt: ahora,
    updatedAt: ahora,
  };
  await getDb().transaction(async (tx) => {
    await tx.insert(schema.brainDeployment).values(fila);
    await auditar(
      {
        actorUserId: actor.userId,
        action: "cerebro_creado",
        via: actor.via,
        tokenId: actor.tokenId,
        ip: actor.ip,
        detail: { deploymentId: id, name: fila.name, host: hostDe(fila.dispatchUrl), secretoPegado: Boolean(input.secret?.trim()) },
      },
      tx
    );
  });
  return {
    secret,
    despliegue: despliegueVista(
      { ...fila, lastHealthAt: null, lastHealthOk: null, lastHealthDetail: null },
      0
    ),
  };
}

/**
 * Editar nombre/URLs y, en la MISMA transacción, pausar o reactivar
 * (auditoría 070, B-3). La salud se valida contra el despacho final (el
 * nuevo o el que ya tenía).
 */
export async function actualizarDespliegue(
  actor: Actor,
  id: string,
  input: { name?: string; dispatchUrl?: string; healthUrl?: string | null; status?: EstadoDespliegue }
): Promise<DesplieguePublico> {
  const actual = await filaDe(id);
  const cambios: Partial<typeof schema.brainDeployment.$inferInsert> = {};
  if (input.name !== undefined) cambios.name = input.name.trim();
  if (input.dispatchUrl !== undefined) {
    const r = revisarUrlDespacho(input.dispatchUrl);
    if (!r.ok) throw errorUrl("dispatchUrl", r.fallo);
    cambios.dispatchUrl = r.url.toString();
  }
  const despachoFinal = cambios.dispatchUrl ?? actual.dispatchUrl;
  const saludPedida = input.healthUrl !== undefined ? input.healthUrl : actual.healthUrl;
  if (saludPedida === null || saludPedida === "") {
    if (input.healthUrl !== undefined) cambios.healthUrl = null;
  } else {
    const r = revisarUrlSalud(saludPedida, despachoFinal);
    if (!r.ok) throw errorUrl("healthUrl", r.fallo);
    if (input.healthUrl !== undefined) cambios.healthUrl = r.url.toString();
  }
  const campos = Object.keys(cambios);
  const cambiaEstado = input.status !== undefined && input.status !== actual.status;
  if (campos.length || cambiaEstado) {
    await getDb().transaction(async (tx) => {
      await tx
        .update(schema.brainDeployment)
        .set({ ...cambios, ...(cambiaEstado ? { status: input.status } : {}), updatedAt: new Date() })
        .where(eq(schema.brainDeployment.id, id));
      if (campos.length) {
        await auditar(
          { actorUserId: actor.userId, action: "cerebro_actualizado", via: actor.via, tokenId: actor.tokenId, ip: actor.ip, detail: { deploymentId: id, campos } },
          tx
        );
      }
      if (cambiaEstado) {
        await auditar(
          {
            actorUserId: actor.userId,
            action: input.status === "pausado" ? "cerebro_pausado" : "cerebro_reactivado",
            via: actor.via,
            tokenId: actor.tokenId,
            ip: actor.ip,
            detail: { deploymentId: id },
          },
          tx
        );
      }
    });
    invalidarCacheCerebro(id);
  }
  return obtenerDespliegue(id);
}

/** Rota el secreto: el anterior deja de valer en el acto (en este proceso). */
export async function rotarSecreto(
  actor: Actor,
  id: string,
  pegado?: string | null
): Promise<{ secret: string; despliegue: DesplieguePublico }> {
  await filaDe(id);
  const secret = pegado?.trim() || generarSecreto();
  if (!secretoValido(secret)) {
    throw new BlueprintError("secreto_invalido", 422, [
      { path: "secret", message: `Mínimo ${MIN_SECRETO} caracteres, sin espacios` },
    ]);
  }
  await getDb().transaction(async (tx) => {
    await tx
      .update(schema.brainDeployment)
      .set({ ...cifrar(secret), updatedAt: new Date() })
      .where(eq(schema.brainDeployment.id, id));
    await auditar(
      { actorUserId: actor.userId, action: "cerebro_secreto_rotado", via: actor.via, tokenId: actor.tokenId, ip: actor.ip, detail: { deploymentId: id, secretoPegado: Boolean(pegado?.trim()) } },
      tx
    );
  });
  invalidarCacheCerebro(id);
  return { secret, despliegue: await obtenerDespliegue(id) };
}

export async function cambiarEstadoDespliegue(
  actor: Actor,
  id: string,
  status: EstadoDespliegue
): Promise<DesplieguePublico> {
  const f = await filaDe(id);
  if (f.status !== status) {
    await getDb().transaction(async (tx) => {
      await tx
        .update(schema.brainDeployment)
        .set({ status, updatedAt: new Date() })
        .where(eq(schema.brainDeployment.id, id));
      await auditar(
        {
          actorUserId: actor.userId,
          action: status === "pausado" ? "cerebro_pausado" : "cerebro_reactivado",
          via: actor.via,
          tokenId: actor.tokenId,
          ip: actor.ip,
          detail: { deploymentId: id },
        },
        tx
      );
    });
    invalidarCacheCerebro(id);
  }
  return obtenerDespliegue(id);
}

/** Solo sin negocios asignados (la FK es RESTRICT; aquí se dice antes y claro). */
/** Auditoría 070 (M-2) — ¿Violación de llave foránea (`23503`) de Postgres? */
export function esViolacionFk(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    if ((e as { code?: unknown }).code === "23503") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

function errorEnUso(n?: number): BlueprintError {
  return new BlueprintError("cerebro_en_uso", 409, [
    {
      path: "id",
      message: n ? `Atiende a ${n} negocio(s): reasígnalos antes de borrarlo` : "Atiende negocios: reasígnalos antes de borrarlo",
    },
  ]);
}

/**
 * Solo sin negocios asignados. Auditoría 070 (M-2): la fila se bloquea
 * (`FOR UPDATE`) y el conteo se hace DENTRO de la transacción; si aun así una
 * asignación se cuela, la FK (RESTRICT) lo impide y se responde 409, no 500.
 */
export async function borrarDespliegue(actor: Actor, id: string): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      const [f] = await tx
        .select({ name: schema.brainDeployment.name })
        .from(schema.brainDeployment)
        .where(eq(schema.brainDeployment.id, id))
        .for("update")
        .limit(1);
      if (!f) throw new BlueprintError("cerebro_no_encontrado", 404);
      const [c] = await tx
        .select({ n: count() })
        .from(schema.organization)
        .where(eq(schema.organization.brainDeploymentId, id));
      const n = Number(c?.n ?? 0);
      if (n > 0) throw errorEnUso(n);
      await tx.delete(schema.brainDeployment).where(eq(schema.brainDeployment.id, id));
      await auditar(
        { actorUserId: actor.userId, action: "cerebro_borrado", via: actor.via, tokenId: actor.tokenId, ip: actor.ip, detail: { deploymentId: id, name: f.name } },
        tx
      );
    });
  } catch (err) {
    if (esViolacionFk(err)) throw errorEnUso();
    throw err;
  }
  invalidarCacheCerebro(id);
}

/**
 * Asigna (o quita, con `null`) el cerebro de un negocio. Solo a un despliegue
 * activo: asignar uno pausado dejaría al negocio sin respuesta sin avisar.
 */
/**
 * Pura de la transacción (auditoría 070, A-9 y M-2): exige un despliegue que
 * exista y esté activo, con su fila bloqueada (`FOR SHARE`) hasta confirmar,
 * para que nadie lo pause ni lo borre a mitad de la asignación.
 */
export async function exigirDespliegueActivo(tx: Tx, deploymentId: string): Promise<void> {
  const [d] = await tx
    .select({ status: schema.brainDeployment.status })
    .from(schema.brainDeployment)
    .where(eq(schema.brainDeployment.id, deploymentId))
    .for("share")
    .limit(1);
  if (!d) {
    throw new BlueprintError("cerebro_no_encontrado", 422, [
      { path: "brain.deployment", message: "No existe ese despliegue de cerebro" },
    ]);
  }
  if (d.status !== "activo") {
    throw new BlueprintError("cerebro_pausado", 422, [
      { path: "brain.deployment", message: "Ese despliegue está pausado" },
    ]);
  }
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Asigna (o quita, con `null`) el cerebro de un negocio. Solo a un despliegue
 * activo: asignar uno pausado dejaría al negocio sin respuesta sin avisar.
 * Reasignar el mismo no exige nada (A-9: «sin cambios» no falla aunque esté
 * pausado).
 */
export async function asignarCerebro(
  actor: Actor,
  organizationId: string,
  deploymentId: string | null
): Promise<{ antes: string | null; despues: string | null }> {
  try {
    return await getDb().transaction(async (tx) => {
      const [org] = await tx
        .select({ antes: schema.organization.brainDeploymentId })
        .from(schema.organization)
        .where(eq(schema.organization.id, organizationId))
        .for("update")
        .limit(1);
      if (!org) throw new BlueprintError("organizacion_no_encontrada", 404);
      const antes = org.antes ?? null;
      if (antes === deploymentId) return { antes, despues: deploymentId };
      if (deploymentId) await exigirDespliegueActivo(tx, deploymentId);
      await tx
        .update(schema.organization)
        .set({ brainDeploymentId: deploymentId })
        .where(eq(schema.organization.id, organizationId));
      await auditar(
        {
          actorUserId: actor.userId,
          action: "cerebro_asignado",
          organizationId,
          via: actor.via,
          tokenId: actor.tokenId,
          ip: actor.ip,
          detail: { antes, despues: deploymentId },
        },
        tx
      );
      return { antes, despues: deploymentId };
    });
  } catch (err) {
    // M-2: un borrado concurrente que se coló → 422, no 500.
    if (esViolacionFk(err)) {
      throw new BlueprintError("cerebro_no_encontrado", 422, [
        { path: "brain.deployment", message: "No existe ese despliegue de cerebro" },
      ]);
    }
    throw err;
  }
}

/** El despliegue asignado a un negocio (solo id, nombre y estado). */
export async function cerebroDeOrganizacion(
  organizationId: string
): Promise<{ id: string; name: string; status: EstadoDespliegue; lastHealthOk: boolean | null } | null> {
  const [f] = await getDb()
    .select({
      id: schema.brainDeployment.id,
      name: schema.brainDeployment.name,
      status: schema.brainDeployment.status,
      lastHealthOk: schema.brainDeployment.lastHealthOk,
    })
    .from(schema.organization)
    .innerJoin(schema.brainDeployment, eq(schema.brainDeployment.id, schema.organization.brainDeploymentId))
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return f ? { ...f, lastHealthOk: f.lastHealthOk ?? null } : null;
}
