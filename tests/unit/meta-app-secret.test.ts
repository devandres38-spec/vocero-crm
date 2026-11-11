import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { baseGrabadora } from "./fixtures/base-grabadora";

/**
 * 073 (D14 de Aliantis) — El App Secret de cada negocio, por canal: se guarda
 * cifrado, nunca en claro, y solo salen sus últimos 4.
 */
beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

import { schema } from "@/lib/db";
import {
  appSecretDe,
  appSecretValido,
  CANALES_META,
  estadoDeFirmas,
  guardarAppSecret,
} from "@/server/whatsapp/app-secret";

const SECRETO = "0123456789abcdef0123456789abcdef";
let base: ReturnType<typeof baseGrabadora>;
beforeEach(() => {
  base = baseGrabadora();
});
type Db = Parameters<typeof guardarAppSecret>[0];

describe("073 — App Secret por negocio y canal", () => {
  it("el formato: 32 hexadecimales", () => {
    expect(appSecretValido(SECRETO)).toBe(true);
    for (const malo of ["", "0123", SECRETO.toUpperCase(), `${SECRETO}0`, "z".repeat(32)]) {
      expect(appSecretValido(malo)).toBe(false);
    }
  });

  it("se guarda cifrado: el secreto nunca aparece en lo que se escribe", async () => {
    await guardarAppSecret(base.db as unknown as Db, {
      organizationId: "org_a",
      canales: ["whatsapp"],
      secreto: SECRETO,
      appId: "1234567890",
    });
    const [insert] = base.ops.filter((o) => o.op === "insert" && o.tabla === schema.metaApp);
    expect(insert?.valores).toMatchObject({
      organizationId: "org_a",
      canal: "whatsapp",
      appId: "1234567890",
    });
    expect(JSON.stringify(insert?.valores)).not.toContain(SECRETO);
  });

  it("`todos` lo guarda en los tres canales", async () => {
    await guardarAppSecret(base.db as unknown as Db, {
      organizationId: "org_a",
      canales: CANALES_META,
      secreto: SECRETO,
    });
    const canales = base.ops
      .filter((o) => o.op === "insert")
      .map((o) => (o.valores as { canal: string }).canal);
    expect(canales).toEqual(["whatsapp", "instagram", "messenger"]);
  });

  it("se lee descifrado, del negocio y del canal pedidos", async () => {
    await guardarAppSecret(base.db as unknown as Db, {
      organizationId: "org_a",
      canales: ["instagram"],
      secreto: SECRETO,
    });
    const guardado = base.ops[0]?.valores as {
      secretCipher: string;
      secretIv: string;
      secretTag: string;
    };
    base.responder(schema.metaApp, [
      { cipher: guardado.secretCipher, iv: guardado.secretIv, tag: guardado.secretTag },
    ]);
    expect(await appSecretDe("org_a", "instagram", base.db as never)).toBe(SECRETO);
    const lectura = base.ops.find((o) => o.op === "select" && o.tabla === schema.metaApp);
    expect(lectura?.where?.params).toEqual(["org_a", "instagram"]);
  });

  it("sin secreto: null", async () => {
    expect(await appSecretDe("org_a", "messenger", base.db as never)).toBeNull();
  });

  it("el estado para Ajustes solo trae los últimos 4", async () => {
    await guardarAppSecret(base.db as unknown as Db, {
      organizationId: "org_a",
      canales: ["whatsapp"],
      secreto: SECRETO,
    });
    const g = base.ops[0]?.valores as { secretCipher: string; secretIv: string; secretTag: string };
    base.responder(schema.metaApp, [
      { canal: "whatsapp", cipher: g.secretCipher, iv: g.secretIv, tag: g.secretTag },
    ]);
    const estado = await estadoDeFirmas("org_a", base.db as never);
    expect(estado).toEqual([{ canal: "whatsapp", ultimos4: "cdef" }]);
    expect(JSON.stringify(estado)).not.toContain(SECRETO);
  });
});
