import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseGrabadora, type Operacion } from "./fixtures/base-grabadora";

/**
 * 072 (D21 de Aliantis) — Retención por negocio. La base simulada graba cada
 * operación con su WHERE en SQL de verdad: aquí se afirma QUÉ se vacía, con
 * qué corte y dentro de qué negocio. El SQL contra Postgres real lo prueba
 * `scripts/e2e-retencion.mjs`.
 */
const h = vi.hoisted(() => ({
  base: null as unknown as ReturnType<
    typeof import("./fixtures/base-grabadora").baseGrabadora
  >,
  borrarArchivo: vi.fn(async (_org: string, _id: string) => undefined),
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb: () => h.base.db };
});
vi.mock("@/server/whatsapp/media", () => ({ deleteMediaFile: h.borrarArchivo }));
// 075 — Los negocios salen de la función de solo ids; sus días, de su perfil (dentro de cada uno).
vi.mock("@/server/db-sistema", () => ({ todasLasOrganizaciones: async () => ["org_a", "org_b"] }));

import { schema } from "@/lib/db";
import {
  aplicarRetencion,
  corteDe,
  RETENTION_TEXT,
  TANDA_MENSAJES,
  vaciarNegocio,
} from "@/server/retencion/aplicar";

const AHORA = new Date("2026-11-10T08:00:00.000Z");
const corteIso = (dias: number) => corteDe(AHORA, dias).toISOString();

beforeEach(() => {
  h.base = baseGrabadora();
  h.borrarArchivo.mockClear();
});

const de = (tabla: unknown, op: Operacion["op"]) =>
  h.base.ops.filter((o) => o.tabla === tabla && o.op === op);

describe("072 — el corte", () => {
  it("es ahora − N días", () => {
    expect(corteDe(AHORA, 7).toISOString()).toBe("2026-11-03T08:00:00.000Z");
    expect(corteDe(AHORA, 90).toISOString()).toBe("2026-08-12T08:00:00.000Z");
  });
});

describe("072 — mensajes", () => {
  it("vacía el contenido de los mensajes viejos del negocio, sin borrar la fila", async () => {
    h.base.responder(schema.message, [
      { id: "msg_1", mediaAssetId: null },
      { id: "msg_2", mediaAssetId: "ma_1" },
    ]);
    h.base.responder(schema.mediaAsset, [{ id: "ma_1" }]);
    const r = await vaciarNegocio("org_a", 7, AHORA);
    expect(r).toMatchObject({ saltado: false, mensajes: 2, adjuntos: 1 });

    const [busqueda] = de(schema.message, "select");
    // Del negocio, ANTERIOR al corte (estricto: lo que cae justo en él se queda).
    expect(busqueda?.where?.sql).toMatch(/"message"\."created_at" < \$\d+/);
    expect(busqueda?.where?.params).toEqual(
      expect.arrayContaining(["org_a", corteIso(7)]),
    );
    // Solo lo que todavía tiene contenido: una segunda pasada no cambia nada.
    expect(busqueda?.where?.sql).toContain('"message"."text" <> $');
    expect(busqueda?.where?.params).toContain(RETENTION_TEXT);

    const [cambio] = de(schema.message, "update");
    expect(cambio?.valores).toEqual({
      text: RETENTION_TEXT,
      buttons: null,
      mediaAssetId: null,
    });
    expect(cambio?.where?.params).toEqual(
      expect.arrayContaining(["org_a", "msg_1", "msg_2"]),
    );
    expect(cambio?.where?.sql).toContain('"message"."organization_id" = $');
    // Resultados cuenta filas de `message`: ninguna se borra.
    expect(de(schema.message, "delete")).toEqual([]);
  });

  it("borra el adjunto solo si nadie más lo usa (ni otro mensaje ni un anuncio), y el archivo después", async () => {
    h.base.responder(schema.message, [{ id: "msg_1", mediaAssetId: "ma_1" }]);
    h.base.responder(schema.mediaAsset, [{ id: "ma_1" }]);
    await vaciarNegocio("org_a", 7, AHORA);
    const [adjunto] = de(schema.mediaAsset, "delete");
    expect(adjunto?.where?.params).toEqual(
      expect.arrayContaining(["org_a", "ma_1"]),
    );
    expect(adjunto?.where?.sql).toMatch(
      /not exists \(select 1 from "message" where "message"\."media_asset_id" = "media_asset"\."id"\)/,
    );
    expect(adjunto?.where?.sql).toMatch(
      /not exists \(select 1 from "ad_attribution" where "ad_attribution"\."image_asset_id" = "media_asset"\."id"\)/,
    );
    expect(h.borrarArchivo).toHaveBeenCalledWith("org_a", "ma_1");
  });

  it("trabaja por tandas hasta que no quedan", async () => {
    const tanda = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `msg_${i}`, mediaAssetId: null }));
    h.base.responder(schema.message, tanda(TANDA_MENSAJES));
    h.base.responder(schema.message, []); // el update de la primera tanda
    h.base.responder(schema.message, tanda(3));
    const r = await vaciarNegocio("org_a", 7, AHORA);
    expect(r.mensajes).toBe(TANDA_MENSAJES + 3);
    expect(de(schema.message, "select")).toHaveLength(2);
    // Cada tanda en su transacción, con el candado del negocio.
    const candados = h.base.ops.filter((o) => o.op === "execute");
    expect(candados.length).toBeGreaterThanOrEqual(3);
    for (const c of candados) {
      expect(c.where?.sql).toContain("pg_try_advisory_xact_lock");
      expect(c.where?.params).toEqual(["retencion:org_a"]);
    }
  });

  it("si otra instancia tiene el negocio, lo salta sin tocar nada", async () => {
    h.base = baseGrabadora({ candado: () => false });
    const r = await vaciarNegocio("org_a", 7, AHORA);
    expect(r.saltado).toBe(true);
    expect(h.base.ops.filter((o) => o.op !== "execute")).toEqual([]);
  });
});

describe("072 — lo demás del negocio", () => {
  async function pasada() {
    await vaciarNegocio("org_a", 30, AHORA);
  }

  it("cada cambio va dentro del negocio y anterior al corte", async () => {
    await pasada();
    const cambios = h.base.ops.filter(
      (o) => o.op === "update" || o.op === "delete",
    );
    expect(cambios.length).toBeGreaterThanOrEqual(7);
    for (const c of cambios) {
      expect(c.where?.params).toContain("org_a");
      expect(c.where?.params).toContain(corteIso(30));
      expect(c.where?.params).not.toContain("org_b");
    }
  });

  it("borra las notas internas viejas", async () => {
    await pasada();
    const [notas] = de(schema.conversationNote, "delete");
    expect(notas?.where?.sql).toMatch(/"conversation_note"\."created_at" < \$/);
  });

  it("una cita futura agendada hace tiempo conserva su nota", async () => {
    await pasada();
    const [citas] = de(schema.booking, "update");
    expect(citas?.valores).toEqual({ notes: null });
    expect(citas?.where?.sql).toMatch(/"booking"\."created_at" < \$/);
    expect(citas?.where?.sql).toMatch(/"booking"\."scheduled_at" < \$/);
  });

  it("la nota de pérdida se vacía; el motivo se queda", async () => {
    await pasada();
    const [etapas] = de(schema.leadStageEvent, "update");
    expect(etapas?.valores).toEqual({ lossNote: null });
    expect(etapas?.where?.sql).toMatch(/"lead_stage_event"\."occurred_at" < \$/);
  });

  it("solo el contacto inactivo pierde notas y ficha; nombre, teléfono e identidad se quedan", async () => {
    await pasada();
    const [contactos] = de(schema.contact, "update");
    expect(contactos?.valores).toEqual({ notes: null, ficha: null });
    expect(contactos?.where?.sql).toMatch(/"contact"\."updated_at" < \$/);
    expect(contactos?.where?.sql).toMatch(
      /not exists \(select 1 from "conversation" where \("conversation"\."contact_id" = "contact"\."id" and "conversation"\."last_message_at" >= \$\d+\)\)/,
    );
  });

  it("vacía las transcripciones del Laboratorio y borra los webhooks viejos en cualquier estado", async () => {
    await pasada();
    const [lab] = de(schema.agentTestCase, "update");
    expect(lab?.valores).toEqual({ transcript: null, hallazgos: null });
    const [webhooks] = de(schema.webhookEvent, "delete");
    expect(webhooks?.where?.sql).not.toContain('"status"');
  });

  it("los adjuntos huérfanos viejos se borran con la misma protección", async () => {
    h.base.responder(schema.mediaAsset, [{ id: "ma_viejo" }]);
    await pasada();
    const [huerfanos] = de(schema.mediaAsset, "delete");
    expect(huerfanos?.where?.sql).toMatch(/"media_asset"\."created_at" < \$/);
    expect(huerfanos?.where?.sql).toContain('"ad_attribution"');
    expect(h.borrarArchivo).toHaveBeenCalledWith("org_a", "ma_viejo");
  });

  it("no toca el consentimiento, el lead, la conversación ni la tarjeta del anuncio", async () => {
    await pasada();
    for (const tabla of [
      schema.consent,
      schema.lead,
      schema.conversation,
      schema.adAttribution,
      schema.conversionEvent,
    ]) {
      expect(
        h.base.ops.filter(
          (o) => o.tabla === tabla && (o.op === "update" || o.op === "delete"),
        ),
      ).toEqual([]);
    }
  });
});

describe("072 — la pasada diaria", () => {
  it("cada negocio con sus días; sin perfil, 90", async () => {
    h.base.responder(schema.privacyProfile, [{ dias: 7 }]);
    h.base.responder(schema.privacyProfile, []);
    const r = await aplicarRetencion(AHORA);
    expect(r?.map((x) => [x.organizationId, x.dias])).toEqual([
      ["org_a", 7],
      ["org_b", 90],
    ]);
    const busquedas = de(schema.message, "select");
    expect(busquedas[0]?.where?.params).toEqual(
      expect.arrayContaining(["org_a", corteIso(7)]),
    );
    expect(busquedas[1]?.where?.params).toEqual(
      expect.arrayContaining(["org_b", corteIso(90)]),
    );
    expect(busquedas[1]?.where?.params).not.toContain("org_a");
  });

  it("un negocio que falla no frena a los demás", async () => {
    h.base.responder(schema.privacyProfile, [{ dias: 7 }]);
    h.base.responder(schema.privacyProfile, [{ dias: 7 }]);
    let primera = true;
    h.base = Object.assign(h.base, {
      db: {
        ...h.base.db,
        transaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
          if (primera) {
            primera = false;
            throw new Error("se cayó la base");
          }
          return fn(h.base.db);
        },
      },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await aplicarRetencion(AHORA);
    expect(r?.map((x) => x.organizationId)).toEqual(["org_b"]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
