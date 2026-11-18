import { createHmac, randomBytes } from "node:crypto";
import { asc, count, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { auditar } from "@/server/platform/auditoria";
import { BlueprintError } from "@/server/platform/blueprint/errores";

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

/** Pura: la URL es http(s) y no lleva usuario ni clave. `null` si no sirve. */
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
  return u;
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
const TTL_CACHE_MS = 60_000;
type EnCache = { secreto: string; status: EstadoDespliegue; hasta: number };
const cache = new Map<string, EnCache>();

export function invalidarCacheCerebro(id?: string): void {
  if (id) cache.delete(id);
  else cache.clear();
}

/** El secreto en claro de un despliegue, o `null` si no existe. */
export async function secretoDeDespliegue(
  id: string,
  ahora: number = Date.now()
): Promise<{ secreto: string; status: EstadoDespliegue } | null> {
  const c = cache.get(id);
  if (c && c.hasta > ahora) return { secreto: c.secreto, status: c.status };
  const [f] = await getDb()
    .select({
      cipher: schema.brainDeployment.secretCipher,
      iv: schema.brainDeployment.secretIv,
      tag: schema.brainDeployment.secretTag,
      status: schema.brainDeployment.status,
    })
    .from(schema.brainDeployment)
    .where(eq(schema.brainDeployment.id, id))
    .limit(1);
  if (!f) {
    cache.delete(id);
    return null;
  }
  const secreto = decryptSecret({ cipher: f.cipher, iv: f.iv, tag: f.tag });
  cache.set(id, { secreto, status: f.status, hasta: ahora + TTL_CACHE_MS });
  return { secreto, status: f.status };
}

/* --------------------------------------------------------------- servicio */

export type Actor = { userId: string; ip?: string | null; via?: "sesion" | "api" | "mcp"; tokenId?: string | null };

function errorUrl(path: string): BlueprintError {
  return new BlueprintError("url_invalida", 422, [
    { path, message: "Debe ser una URL http(s) sin usuario ni clave" },
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
  const despacho = urlDeCerebro(input.dispatchUrl);
  if (!despacho) throw errorUrl("dispatchUrl");
  const salud = input.healthUrl ? urlDeCerebro(input.healthUrl) : null;
  if (input.healthUrl && !salud) throw errorUrl("healthUrl");
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

export async function actualizarDespliegue(
  actor: Actor,
  id: string,
  input: { name?: string; dispatchUrl?: string; healthUrl?: string | null }
): Promise<DesplieguePublico> {
  await filaDe(id);
  const cambios: Partial<typeof schema.brainDeployment.$inferInsert> = {};
  if (input.name !== undefined) cambios.name = input.name.trim();
  if (input.dispatchUrl !== undefined) {
    const u = urlDeCerebro(input.dispatchUrl);
    if (!u) throw errorUrl("dispatchUrl");
    cambios.dispatchUrl = u.toString();
  }
  if (input.healthUrl !== undefined) {
    if (input.healthUrl === null || input.healthUrl === "") cambios.healthUrl = null;
    else {
      const u = urlDeCerebro(input.healthUrl);
      if (!u) throw errorUrl("healthUrl");
      cambios.healthUrl = u.toString();
    }
  }
  const campos = Object.keys(cambios);
  if (campos.length) {
    await getDb().transaction(async (tx) => {
      await tx
        .update(schema.brainDeployment)
        .set({ ...cambios, updatedAt: new Date() })
        .where(eq(schema.brainDeployment.id, id));
      await auditar(
        { actorUserId: actor.userId, action: "cerebro_actualizado", via: actor.via, tokenId: actor.tokenId, ip: actor.ip, detail: { deploymentId: id, campos } },
        tx
      );
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
export async function borrarDespliegue(actor: Actor, id: string): Promise<void> {
  const f = await filaDe(id);
  const conteo = await contarNegocios();
  const n = conteo.get(id) ?? 0;
  if (n > 0) {
    throw new BlueprintError("cerebro_en_uso", 409, [
      { path: "id", message: `Atiende a ${n} negocio(s): reasígnalos antes de borrarlo` },
    ]);
  }
  await getDb().transaction(async (tx) => {
    await tx.delete(schema.brainDeployment).where(eq(schema.brainDeployment.id, id));
    await auditar(
      { actorUserId: actor.userId, action: "cerebro_borrado", via: actor.via, tokenId: actor.tokenId, ip: actor.ip, detail: { deploymentId: id, name: f.name } },
      tx
    );
  });
  invalidarCacheCerebro(id);
}

/**
 * Asigna (o quita, con `null`) el cerebro de un negocio. Solo a un despliegue
 * activo: asignar uno pausado dejaría al negocio sin respuesta sin avisar.
 */
export async function asignarCerebro(
  actor: Actor,
  organizationId: string,
  deploymentId: string | null
): Promise<{ antes: string | null; despues: string | null }> {
  if (deploymentId) {
    const f = await filaDe(deploymentId).catch(() => null);
    if (!f) {
      throw new BlueprintError("cerebro_no_encontrado", 422, [
        { path: "brain.deployment", message: "No existe ese despliegue de cerebro" },
      ]);
    }
    if (f.status !== "activo") {
      throw new BlueprintError("cerebro_pausado", 422, [
        { path: "brain.deployment", message: "Ese despliegue está pausado" },
      ]);
    }
  }
  return getDb().transaction(async (tx) => {
    const [org] = await tx
      .select({ antes: schema.organization.brainDeploymentId })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1);
    if (!org) throw new BlueprintError("organizacion_no_encontrada", 404);
    const antes = org.antes ?? null;
    if (antes !== deploymentId) {
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
    }
    return { antes, despues: deploymentId };
  });
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
