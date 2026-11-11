import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * 073 (D14 de Aliantis) — El App Secret de la app de Meta de cada negocio, por
 * canal. Con él se verifica la firma de los webhooks de ese canal. Se guarda
 * cifrado (AES-256-GCM, como el token) y nunca sale entero: fuera de aquí
 * solo viajan sus últimos 4.
 */

export const CANALES_META = ["whatsapp", "instagram", "messenger"] as const;
export type CanalMeta = (typeof CANALES_META)[number];

/** Formato del App Secret de Meta: 32 caracteres hexadecimales (estimación; se confirma con una app real). */
export const FORMATO_APP_SECRET = /^[0-9a-f]{32}$/;

export function appSecretValido(secreto: string): boolean {
  return FORMATO_APP_SECRET.test(secreto);
}

export function ultimos4(secreto: string): string {
  return secreto.slice(-4);
}

type Db = ReturnType<typeof getDb>;

/** Guarda (o reemplaza) el secreto de un negocio en los canales dados. El secreto ya viene validado. */
export async function guardarAppSecret(
  db: Pick<Db, "insert">,
  entrada: {
    organizationId: string;
    canales: readonly CanalMeta[];
    secreto: string;
    appId?: string | null;
  }
): Promise<void> {
  for (const canal of entrada.canales) {
    const cifrado = encryptSecret(entrada.secreto);
    const columnas = {
      appId: entrada.appId ?? null,
      secretCipher: cifrado.cipher,
      secretIv: cifrado.iv,
      secretTag: cifrado.tag,
    };
    await db
      .insert(schema.metaApp)
      .values({ organizationId: entrada.organizationId, canal, ...columnas })
      .onConflictDoUpdate({
        target: [schema.metaApp.organizationId, schema.metaApp.canal],
        set: { ...columnas, updatedAt: new Date() },
      });
  }
}

/** El secreto de un negocio para un canal, descifrado; `null` si no hay. */
export async function appSecretDe(
  organizationId: string,
  canal: CanalMeta,
  db: Pick<Db, "select"> = getDb()
): Promise<string | null> {
  const [fila] = await db
    .select({
      cipher: schema.metaApp.secretCipher,
      iv: schema.metaApp.secretIv,
      tag: schema.metaApp.secretTag,
    })
    .from(schema.metaApp)
    .where(
      scoped(schema.metaApp.organizationId, organizationId, eq(schema.metaApp.canal, canal))
    )
    .limit(1);
  return fila ? decryptSecret(fila) : null;
}

/** Para Ajustes → Webhook: qué canales tienen secreto y sus últimos 4. Nunca el secreto. */
export async function estadoDeFirmas(
  organizationId: string,
  db: Pick<Db, "select"> = getDb()
): Promise<{ canal: CanalMeta; ultimos4: string }[]> {
  const filas = await db
    .select({
      canal: schema.metaApp.canal,
      cipher: schema.metaApp.secretCipher,
      iv: schema.metaApp.secretIv,
      tag: schema.metaApp.secretTag,
    })
    .from(schema.metaApp)
    .where(scoped(schema.metaApp.organizationId, organizationId));
  return filas.map((f) => ({ canal: f.canal, ultimos4: ultimos4(decryptSecret(f)) }));
}
