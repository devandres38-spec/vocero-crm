import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * Cifrado en reposo de secretos (token de WhatsApp) con AES-256-GCM.
 * GCM aporta integridad además de confidencialidad: si el tag no coincide,
 * el descifrado lanza (dato manipulado o clave incorrecta).
 */

export type EncryptedValue = {
  cipher: string; // base64
  iv: string; // base64 (12 bytes)
  tag: string; // base64 (16 bytes)
};

function getKey(): Buffer {
  const key = Buffer.from(getEnv().ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY debe ser 32 bytes en base64");
  }
  return key;
}

/** Auditoría 070 (B-1): tamaños de GCM fijos y comprobados. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encryptSecret(plain: string): EncryptedValue {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv, { authTagLength: TAG_BYTES });
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  return {
    cipher: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(value: EncryptedValue): string {
  const iv = Buffer.from(value.iv, "base64");
  const tag = Buffer.from(value.tag, "base64");
  // Auditoría 070 (B-1): un tag GCM truncado debilita la integridad; un IV de
  // otro tamaño no lo produjo este módulo. Se rechazan antes de descifrar.
  if (iv.length !== IV_BYTES) throw new Error("IV inválido");
  if (tag.length !== TAG_BYTES) throw new Error("Tag de autenticación inválido");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(value.cipher, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
