import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { auditar } from "@/server/platform/auditoria";
import { esSuperAdmin } from "@/server/tenant/consultas";

/**
 * 069 (D14, FR-018) — Tokens personales de un Super-Admin para la API REST y
 * el MCP. Una credencial POR PERSONA (no una llave compartida de instancia):
 * cada acción de una IA queda en la auditoría con quién y con qué token.
 *
 * - Formato `alp_` + 32 bytes base64url; se muestra UNA vez.
 * - En la base: su SHA-256 y sus últimos 4 caracteres (para reconocerlo).
 * - Alcances: `read` (listar, exportar, planificar, catálogo) y `provision`
 *   (además crear, aplicar, invitar, suspender).
 * - Caducidad opcional, revocación inmediata, `last_used_at`.
 * - Deja de valer si su dueño deja de ser Super-Admin.
 */

export type Alcance = "read" | "provision";
export const PREFIJO_TOKEN = "alp_";

export function hashTokenApi(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function pareceTokenApi(valor: string | null | undefined): valor is string {
  return typeof valor === "string" && valor.startsWith(PREFIJO_TOKEN) && valor.length > 20 && valor.length < 200;
}

/** El Bearer de la petición, si es un token de plataforma. */
export function tokenDeHeaders(h: Pick<Headers, "get">): string | null {
  const auth = h.get("authorization");
  const m = auth ? /^Bearer\s+(\S+)$/i.exec(auth.trim()) : null;
  return m && pareceTokenApi(m[1]) ? m[1]! : null;
}

export type TokenPublico = {
  id: string;
  name: string;
  last4: string;
  scopes: Alcance[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export async function crearToken(
  userId: string,
  input: { name: string; scopes: Alcance[]; expiresAt?: Date | null },
  ip?: string | null
): Promise<{ token: string; publico: TokenPublico }> {
  const token = `${PREFIJO_TOKEN}${randomBytes(32).toString("base64url")}`;
  const id = newId("platformApiToken");
  const scopes = [...new Set(input.scopes)].sort() as Alcance[];
  const fila = {
    id,
    userId,
    name: input.name,
    tokenHash: hashTokenApi(token),
    last4: token.slice(-4),
    scopes,
    expiresAt: input.expiresAt ?? null,
  };
  await getDb().transaction(async (tx) => {
    await tx.insert(schema.platformApiToken).values(fila);
    await auditar(
      { actorUserId: userId, action: "token_creado", ip, detail: { tokenId: id, name: input.name, scopes } },
      tx
    );
  });
  return {
    token,
    publico: {
      id,
      name: input.name,
      last4: fila.last4,
      scopes,
      expiresAt: fila.expiresAt?.toISOString() ?? null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    },
  };
}

export async function listarTokens(userId: string): Promise<TokenPublico[]> {
  const filas = await getDb()
    .select({
      id: schema.platformApiToken.id,
      name: schema.platformApiToken.name,
      last4: schema.platformApiToken.last4,
      scopes: schema.platformApiToken.scopes,
      expiresAt: schema.platformApiToken.expiresAt,
      lastUsedAt: schema.platformApiToken.lastUsedAt,
      revokedAt: schema.platformApiToken.revokedAt,
      createdAt: schema.platformApiToken.createdAt,
    })
    .from(schema.platformApiToken)
    .where(eq(schema.platformApiToken.userId, userId))
    .orderBy(desc(schema.platformApiToken.createdAt));
  return filas.map((f) => ({
    ...f,
    expiresAt: f.expiresAt?.toISOString() ?? null,
    lastUsedAt: f.lastUsedAt?.toISOString() ?? null,
    revokedAt: f.revokedAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
  }));
}

/** Solo los tokens propios. */
export async function revocarToken(userId: string, id: string, ip?: string | null): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const filas = await tx
      .update(schema.platformApiToken)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.platformApiToken.id, id),
          eq(schema.platformApiToken.userId, userId),
          isNull(schema.platformApiToken.revokedAt)
        )
      )
      .returning({ id: schema.platformApiToken.id });
    if (filas.length === 0) return false;
    await auditar({ actorUserId: userId, action: "token_revocado", ip, detail: { tokenId: id } }, tx);
    return true;
  });
}

export type TokenVerificado = { tokenId: string; userId: string; scopes: ReadonlySet<Alcance> };

/** `last_used_at` se escribe como mucho una vez por minuto por token. */
const MARCA_USO_MS = 60_000;

/**
 * El token es válido si existe, no está revocado ni vencido y su dueño sigue
 * siendo Super-Admin. Un rechazo de un token conocido se audita (sabemos de
 * quién es); uno desconocido no tiene actor.
 */
export async function verificarToken(
  token: string,
  ip?: string | null,
  ahora: Date = new Date()
): Promise<TokenVerificado | null> {
  const db = getDb();
  const [fila] = await db
    .select({
      id: schema.platformApiToken.id,
      userId: schema.platformApiToken.userId,
      scopes: schema.platformApiToken.scopes,
      expiresAt: schema.platformApiToken.expiresAt,
      revokedAt: schema.platformApiToken.revokedAt,
      lastUsedAt: schema.platformApiToken.lastUsedAt,
    })
    .from(schema.platformApiToken)
    .where(eq(schema.platformApiToken.tokenHash, hashTokenApi(token)))
    .limit(1);
  if (!fila) return null;
  const motivo = fila.revokedAt
    ? "revocado"
    : fila.expiresAt && fila.expiresAt <= ahora
      ? "vencido"
      : !(await esSuperAdmin(fila.userId))
        ? "sin_rol"
        : null;
  if (motivo) {
    await auditar({ actorUserId: fila.userId, action: "token_rechazado", tokenId: fila.id, via: "api", ip, detail: { motivo } });
    return null;
  }
  if (!fila.lastUsedAt || ahora.getTime() - fila.lastUsedAt.getTime() > MARCA_USO_MS) {
    await db
      .update(schema.platformApiToken)
      .set({ lastUsedAt: ahora })
      .where(eq(schema.platformApiToken.id, fila.id));
  }
  return { tokenId: fila.id, userId: fila.userId, scopes: new Set(fila.scopes) };
}
