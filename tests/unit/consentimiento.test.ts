import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { schema } from "@/lib/db";
import {
  consentimientoDelContacto,
  consentimientoSchema,
  rechazoRegistrado,
  registrarConsentimiento,
} from "@/server/consent";
import { patronDeId } from "@/server/webhooks/borrar";
import { baseGrabadora } from "./fixtures/base-grabadora";

/**
 * 070 (D5; D6 de la 067) — El consentimiento es un registro de solo agregar,
 * por conversación del negocio, y el contexto devuelve el último por tipo.
 */
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory()
      ? archivos(ruta)
      : /\.tsx?$/.test(n)
        ? [ruta]
        : [];
  });
}

describe("070 — consent es de solo agregar", () => {
  it("nada en src/ hace update ni delete sobre consent", () => {
    const culpables = archivos("src").filter((f) => {
      const s = readFileSync(f, "utf8");
      return (
        /\.(update|delete)\(\s*schema\.consent\b/.test(s) ||
        /\b(update|delete\s+from)\s+"?consent"?\b/i.test(s)
      );
    });
    expect(culpables).toEqual([]);
  });
});

describe("070 — registrar", () => {
  const datos = consentimientoSchema.parse({
    conversationId: "cv_1",
    kind: "aviso_privacidad",
    granted: false,
    noticeVersion: "aviso-2026-11-a1",
    sourceMessageId: "msg_9",
  });

  it("de una conversación del negocio: guarda el contacto de la conversación", async () => {
    const { db, ops, responder } = baseGrabadora();
    responder(schema.conversation, [{ contactId: "ct_1" }]);
    responder(schema.consent, [
      { id: "cns_1", createdAt: new Date("2026-11-10T12:00:00Z") },
    ]);
    const r = await registrarConsentimiento("org_1", datos, db as never);
    expect(r).toEqual({
      ok: true,
      id: "cns_1",
      createdAt: new Date("2026-11-10T12:00:00Z"),
    });
    const conv = ops.find((o) => o.op === "select");
    expect(conv?.where?.params).toEqual(
      expect.arrayContaining(["org_1", "cv_1"]),
    );
    expect(ops.find((o) => o.op === "insert")?.valores).toMatchObject({
      organizationId: "org_1",
      contactId: "ct_1",
      conversationId: "cv_1",
      kind: "aviso_privacidad",
      granted: false,
      noticeVersion: "aviso-2026-11-a1",
      sourceMessageId: "msg_9",
    });
  });

  it("de una conversación ajena: no_encontrada y nada se guarda", async () => {
    const { db, ops } = baseGrabadora();
    expect(await registrarConsentimiento("org_1", datos, db as never)).toEqual({
      ok: false,
      motivo: "no_encontrada",
    });
    expect(ops.some((o) => o.op === "insert")).toBe(false);
  });

  it("valida tipo y versión del aviso", () => {
    const base = { conversationId: "cv_1", granted: true };
    expect(
      consentimientoSchema.safeParse({
        ...base,
        kind: "otro",
        noticeVersion: "v",
      }).success,
    ).toBe(false);
    expect(
      consentimientoSchema.safeParse({
        ...base,
        kind: "marketing",
        noticeVersion: "",
      }).success,
    ).toBe(false);
    expect(
      consentimientoSchema.safeParse({
        ...base,
        kind: "marketing",
        noticeVersion: "x".repeat(101),
      }).success,
    ).toBe(false);
  });
});

describe("070 — el último manda", () => {
  it("rechazoRegistrado: solo si el último aviso de ESA conversación es un rechazo", async () => {
    const casos: [unknown[], boolean][] = [
      [[{ granted: false }], true],
      [[{ granted: true }], false],
      [[], false],
    ];
    for (const [filas, esperado] of casos) {
      const { db, ops, responder } = baseGrabadora();
      responder(schema.consent, filas);
      expect(await rechazoRegistrado(db as never, "org_1", "cv_1")).toBe(
        esperado,
      );
      expect(ops[0]?.where?.params).toEqual(
        expect.arrayContaining(["org_1", "cv_1", "aviso_privacidad"]),
      );
    }
  });

  it("el contexto devuelve el último de cada tipo del contacto, o null", async () => {
    const { db, responder } = baseGrabadora();
    responder(schema.consent, [
      {
        granted: true,
        noticeVersion: "v1",
        createdAt: new Date("2026-11-10T12:00:00Z"),
      },
    ]);
    responder(schema.consent, []);
    expect(
      await consentimientoDelContacto("org_1", "ct_1", db as never),
    ).toEqual({
      avisoPrivacidad: {
        granted: true,
        noticeVersion: "v1",
        at: "2026-11-10T12:00:00.000Z",
      },
      marketing: null,
    });
  });
});

describe("070 — buscar el id de un mensaje dentro del payload", () => {
  it("entre comillas y con los comodines de LIKE escapados", () => {
    expect(patronDeId("wamid.ABC=")).toBe('%"wamid.ABC="%');
    expect(patronDeId("a_b%c")).toBe(String.raw`%"a\_b\%c"%`);
  });
});
