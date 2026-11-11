import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filtrarTarjetas, filtrarUbicacion } from "@/server/privacy/adjuntos";
import {
  politicaDesdePerfil,
  type PerfilPrivacidad,
} from "@/server/privacy/perfil";
import {
  HEALTH_OMITTED_TEXT,
  UNREVIEWED_TEXT,
} from "@/server/privacy/privacy-filter";
import { filtrarPayload, marcasDe } from "@/server/privacy/webhook";

/**
 * 070 (D4) — Ubicaciones, tarjetas de contacto y nombres de archivo pasan por
 * el filtro antes de `webhook_event`, con lista blanca: lo demás se descarta.
 */
const vectores = JSON.parse(
  readFileSync("tests/unit/fixtures/privacidad-vectores.json", "utf8"),
) as { perfiles: Record<string, PerfilPrivacidad> };
const DENTAL = politicaDesdePerfil(vectores.perfiles["dental-co"]!);

function entrega(msg: Record<string, unknown>) {
  return {
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "pn_1" },
              messages: [
                { id: "wamid.1", from: "573001112233", timestamp: "1", ...msg },
              ],
            },
          },
        ],
      },
    ],
  };
}
const mensaje = (p: unknown) =>
  (p as ReturnType<typeof entrega>).entry[0]!.changes[0]!.value
    .messages[0] as Record<string, unknown>;

describe("070 — lo que se guarda en webhook_event", () => {
  it("ubicación: coordenadas tal cual, nombre y dirección filtrados, url fuera", () => {
    const m = mensaje(
      filtrarPayload(
        entrega({
          type: "location",
          location: {
            latitude: 4.6,
            longitude: -74.1,
            name: "Clínica, me duele la muela",
            address: "Calle 1, cel 3001234567",
            url: "https://maps.example/x",
          },
        }),
        DENTAL,
      ),
    );
    expect(m.location).toEqual({
      latitude: 4.6,
      longitude: -74.1,
      name: HEALTH_OMITTED_TEXT,
      address: "Calle 1, cel [telefono]",
    });
    expect(marcasDe(m)).toEqual(["salud", "sintoma", "telefono"]);
  });

  it("tarjetas: solo nombre y teléfono enmascarado; correos, direcciones, empresa y cumpleaños fuera", () => {
    const original = entrega({
      type: "contacts",
      contacts: [
        {
          name: {
            formatted_name: "Ana",
            first_name: "Ana",
            last_name: "Pérez Díaz",
          },
          phones: [
            { phone: "+57 300 123 4567", wa_id: "573001234567", type: "CELL" },
          ],
          emails: [{ email: "ana@mail.com" }],
          addresses: [{ street: "Calle 9 # 8-7" }],
          org: { company: "Oncología Andes" },
          birthday: "1990-02-03",
        },
      ],
    });
    const m = mensaje(filtrarPayload(original, DENTAL));
    expect(m.contacts).toEqual([
      {
        name: { formatted_name: "Ana", first_name: "Ana" },
        phones: [{ phone: "[telefono]" }],
      },
    ]);
    const json = JSON.stringify(m);
    for (const crudo of [
      "Pérez Díaz",
      "573001234567",
      "ana@mail.com",
      "Calle 9",
      "Oncología",
      "1990",
    ]) {
      expect(json).not.toContain(crudo);
    }
    expect(marcasDe(m)).toEqual(["telefono"]);
  });

  it("una tarjeta con salud en el nombre: ese campo se omite y el mensaje queda marcado", () => {
    const { payload, marcas } = filtrarTarjetas(
      [
        {
          name: { formatted_name: "Dr. dolor de muela" },
          phones: [{ phone: "+57 300 123 4567" }],
        },
      ],
      DENTAL,
    );
    expect(payload).toEqual([
      {
        name: { formatted_name: HEALTH_OMITTED_TEXT },
        phones: [{ phone: "[telefono]" }],
      },
    ]);
    expect(marcas).toEqual(["salud", "sintoma", "telefono"]);
  });

  it("el nombre de un archivo lo escribió el paciente", () => {
    const m = mensaje(
      filtrarPayload(
        entrega({
          type: "document",
          document: {
            id: "media_9",
            mime_type: "application/pdf",
            filename: "me duele la muela.pdf",
          },
        }),
        DENTAL,
      ),
    );
    expect(m.document).toMatchObject({
      id: "media_9",
      filename: HEALTH_OMITTED_TEXT,
    });
    expect(marcasDe(m)).toEqual(["salud", "sintoma"]);
  });

  it("sin perfil: cada texto queda sin revisar; las coordenadas se conservan", () => {
    const { payload, marcas } = filtrarUbicacion(
      { latitude: 1, longitude: 2, name: "Casa", address: "Calle 1" },
      null,
    );
    expect(payload).toEqual({
      latitude: 1,
      longitude: 2,
      name: UNREVIEWED_TEXT,
      address: UNREVIEWED_TEXT,
    });
    expect(marcas).toEqual(["sin_revisar"]);
  });
});
