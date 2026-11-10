import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { politicaDesdePerfil, type PerfilPrivacidad } from "@/server/privacy/perfil";
import { guardarEvento, huellaDe } from "@/server/webhooks/eventos";

/**
 * 069 — `guardarEvento` guarda el payload filtrado (D1): el texto crudo de un
 * paciente nunca llega a `webhook_event`. La huella de deduplicación sigue
 * siendo la del cuerpo crudo.
 */
const h = vi.hoisted(() => ({
  insertados: [] as Record<string, unknown>[],
  perfil: null as unknown,
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...original,
    getDb: () => ({
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          h.insertados.push(v);
          return {
            onConflictDoNothing: () => ({
              returning: () => Promise.resolve([{ id: v.id }]),
            }),
          };
        },
      }),
    }),
  };
});
vi.mock("@/server/privacy/repositorio", () => ({
  perfilVigente: vi.fn(async () => h.perfil),
}));

const vectores = JSON.parse(
  readFileSync("tests/unit/fixtures/privacidad-vectores.json", "utf8")
) as { perfiles: Record<string, PerfilPrivacidad> };

const SALUD = "me duele mucho la muela desde ayer, mi correo es ana@mail.com";
const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba_1",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "pn_1" },
            messages: [
              { id: "wamid.1", from: "573001112233", timestamp: "1", type: "text", text: { body: SALUD } },
            ],
          },
        },
      ],
    },
  ],
};
const rawBody = JSON.stringify(payload);

beforeEach(() => {
  h.insertados.length = 0;
  h.perfil = null;
});

describe("069 — guardarEvento", () => {
  it("con perfil, guarda el payload filtrado y la huella del cuerpo crudo", async () => {
    h.perfil = { politica: politicaDesdePerfil(vectores.perfiles["dental-co"]!), huella: "x" };

    await guardarEvento({ organizationId: "org_a", fuente: "whatsapp", payload, rawBody });

    const [fila] = h.insertados;
    expect(JSON.stringify(fila?.payload)).not.toContain("muela");
    expect(JSON.stringify(fila?.payload)).not.toContain("ana@mail.com");
    expect(JSON.stringify(fila?.payload)).toContain("_privacidad");
    expect(fila?.huella).toBe(huellaDe(rawBody));
    // El original que recibió la ruta no cambia.
    expect(JSON.stringify(payload)).toContain("muela");
  });

  it("sin perfil, el texto del paciente no se guarda", async () => {
    await guardarEvento({ organizationId: "org_a", fuente: "whatsapp", payload, rawBody });
    const json = JSON.stringify(h.insertados[0]?.payload);
    expect(json).not.toContain("muela");
    expect(json).toContain("no se pudo revisar");
  });
});
