import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 069 — La ingesta guarda las marcas de privacidad (D5): las que dejó
 * `guardarEvento`, o, si el mensaje no pasó por él, las del filtro que corre
 * aquí mismo (segunda red). Ningún texto crudo llega a `message`.
 */

const h = vi.hoisted(() => ({
  politica: null as unknown,
  graphRequest: vi.fn(),
  uploadGraphMedia: vi.fn(),
  saveMediaFile: vi.fn(),
  publish: vi.fn(),
  getCredentialsByOrg: vi.fn(),
  /** Filas que devolverá cada `select`, en orden. */
  selectRows: [] as unknown[][],
  /** Cada INSERT: la tabla y los valores. */
  inserts: [] as { table: unknown; values: Record<string, unknown> }[],
}));

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest: h.graphRequest };
});

vi.mock("@/server/whatsapp/media", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/whatsapp/media")>();
  return {
    ...original,
    uploadGraphMedia: h.uploadGraphMedia,
    saveMediaFile: h.saveMediaFile,
    ensureAssetAvailable: vi.fn(async () => {}),
  };
});

vi.mock("@/server/events/bus", () => ({ publish: h.publish }));

vi.mock("@/server/whatsapp/credentials", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/whatsapp/credentials")>();
  return {
    ...original,
    getCredentialsByOrg: h.getCredentialsByOrg,
    getCredentialsByPhoneNumberId: vi.fn(async () => ({
      organizationId: "org_1",
    })),
  };
});

vi.mock("@/server/inbox/identity", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/inbox/identity")>();
  return {
    ...original,
    getOrCreateContactByIdentity: vi.fn(async () => ({
      contact: { id: "ct_1", channel: "whatsapp" },
    })),
  };
});

vi.mock("@/server/inbox/lead-activity", () => ({
  onLeadActivity: vi.fn(async () => {}),
}));
vi.mock("@/server/brains/config", () => ({ despachoActivo: () => false }));
vi.mock("@/server/privacy/repositorio", () => ({
  perfilDePrivacidad: vi.fn(async () => h.politica),
}));
vi.mock("@/server/dispatch/encolar", () => ({
  despacharAlCerebro: vi.fn(async () => {}),
}));

/**
 * Cadena de Drizzle simulada: todo método devuelve la cadena y al final se
 * resuelve (con `await` o con `.limit()`) a las filas encoladas.
 */
function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of [
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "orderBy",
    "set",
    "onConflictDoNothing",
  ]) {
    c[m] = () => c;
  }
  c.limit = () => Promise.resolve(result());
  c.returning = () => Promise.resolve(result());
  c.then = (ok: (v: unknown[]) => unknown, ko?: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(ok, ko);
  return c;
}

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  let seq = 0;
  return {
    ...original,
    getDb: () => ({
      select: () => {
        const rows = h.selectRows.shift() ?? [];
        return chain(() => rows);
      },
      insert: (table: unknown) => {
        let values: Record<string, unknown> = {};
        const c = chain(() => [
          {
            createdAt: new Date("2026-10-21T12:00:00Z"),
            waTimestamp: null,
            error: null,
            aiGenerated: false,
            origin: "operator",
            mediaAssetId: null,
            replyToWaMessageId: null,
            ...values,
            id: values.id ?? `row_${++seq}`,
          },
        ]);
        c.values = (v: Record<string, unknown>) => {
          values = v;
          h.inserts.push({ table, values: v });
          return c;
        };
        return c;
      },
      update: () => chain(() => []),
    }),
  };
});

import { schema } from "@/lib/db";
import { politicaDesdePerfil, type PerfilPrivacidad } from "@/server/privacy/perfil";
import { HEALTH_OMITTED_TEXT, UNREVIEWED_TEXT } from "@/server/privacy/privacy-filter";
import { filtrarPayload } from "@/server/privacy/webhook";
import { processMessagesValue } from "@/server/inbox/ingest";

const vectores = JSON.parse(
  readFileSync("tests/unit/fixtures/privacidad-vectores.json", "utf8")
) as { perfiles: Record<string, PerfilPrivacidad> };
const DENTAL = politicaDesdePerfil(vectores.perfiles["dental-co"]!);

const entrantes = () =>
  h.inserts.filter((i) => i.table === schema.message).map((i) => i.values);

function valor(msg: Record<string, unknown>) {
  return {
    metadata: { phone_number_id: "pn_1" },
    contacts: [{ wa_id: "573001112233", profile: { name: "Ana" } }],
    messages: [{ from: "573001112233", id: "wamid.1", timestamp: "1792600000", ...msg }],
  };
}

/** El `value` tal como queda en `webhook_event` después de `guardarEvento`. */
function guardado(msg: Record<string, unknown>, politica = DENTAL) {
  const payload = filtrarPayload(
    { entry: [{ changes: [{ field: "messages", value: valor(msg) }] }] },
    politica
  ) as { entry: { changes: { value: ReturnType<typeof valor> }[] }[] };
  return payload.entry[0]!.changes[0]!.value;
}

beforeEach(() => {
  h.inserts.length = 0;
  h.selectRows.length = 0;
  h.politica = null;
});

describe("069 — la ingesta guarda las marcas", () => {
  it("un mensaje que pasó por guardarEvento entra con su texto filtrado y sus marcas", async () => {
    await processMessagesValue(
      guardado({ type: "text", text: { body: "me duele la muela" } }) as never
    );
    expect(entrantes()[0]).toMatchObject({
      text: HEALTH_OMITTED_TEXT,
      privacyFlags: ["salud", "sintoma"],
    });
  });

  it("sin marcas, el texto se guarda con privacy_flags NULL", async () => {
    await processMessagesValue(guardado({ type: "text", text: { body: "hola" } }) as never);
    expect(entrantes()[0]).toMatchObject({ text: "hola", privacyFlags: null });
  });
});

describe("069 — segunda red: lo que no pasó por guardarEvento se filtra aquí", () => {
  it("con perfil: omite la salud y marca", async () => {
    h.politica = DENTAL;
    await processMessagesValue(
      valor({ type: "text", text: { body: "me duele la muela, mi correo es ana@mail.com" } }) as never
    );
    const [m] = entrantes();
    expect(m).toMatchObject({ text: HEALTH_OMITTED_TEXT, privacyFlags: ["salud", "sintoma"] });
    expect(JSON.stringify(h.inserts.map((i) => i.values))).not.toContain("ana@mail.com");
  });

  it("sin perfil: el texto no se guarda, el rótulo de un botón sí", async () => {
    await processMessagesValue(valor({ type: "text", text: { body: "me duele" } }) as never);
    await processMessagesValue(
      valor({
        id: "wamid.2",
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id: "no_acepto", title: "No acepto" } },
      }) as never
    );
    const [texto, boton] = entrantes();
    expect(texto).toMatchObject({ text: UNREVIEWED_TEXT, privacyFlags: ["sin_revisar"] });
    expect(boton).toMatchObject({ text: "No acepto", privacyFlags: null });
  });

  it("el pie de foto también se filtra", async () => {
    h.politica = DENTAL;
    await processMessagesValue(
      valor({ type: "image", image: { id: "media_1", mime_type: "image/jpeg", caption: "me duele la muela" } }) as never
    );
    expect(JSON.stringify(h.inserts.map((i) => i.values))).not.toContain("me duele la muela");
    expect(entrantes()[0]).toMatchObject({ privacyFlags: ["salud", "sintoma"] });
  });
});
