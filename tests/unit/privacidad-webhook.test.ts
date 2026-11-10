import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { politicaDesdePerfil, type PerfilPrivacidad } from "@/server/privacy/perfil";
import { HEALTH_OMITTED_TEXT, UNREVIEWED_TEXT } from "@/server/privacy/privacy-filter";
import { filtrarPayload, marcasDe } from "@/server/privacy/webhook";

/**
 * 069 — Lo que se guarda en `webhook_event` ya viene filtrado (D1 a D4, D9).
 * Ninguna frase cruda de un paciente sobrevive, y la tarjeta del anuncio, los
 * ecos del teléfono del negocio y los errores de Meta quedan intactos.
 */
const vectores = JSON.parse(
  readFileSync("tests/unit/fixtures/privacidad-vectores.json", "utf8")
) as { perfiles: Record<string, PerfilPrivacidad> };
const DENTAL = politicaDesdePerfil(vectores.perfiles["dental-co"]!);

const SALUD = "me duele mucho la muela desde ayer";
const CORREO = "mi correo es ana.perez@gmail.com";
const ANUNCIO = "Blanqueamiento sin dolor: tratamos la sensibilidad y el sangrado de encías";
const ECO = "Doctora, el paciente dice que le duele la muela y tiene fiebre";

const crudas = [SALUD, "ana.perez@gmail.com", "3001234567", "1020345678"];
const sinCrudas = (v: unknown) => {
  const json = JSON.stringify(v);
  return crudas.filter((c) => json.includes(c));
};

function whatsapp(messages: unknown[], extra: Record<string, unknown> = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba_1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "pn_1", display_phone_number: "573000000000" },
              contacts: [{ profile: { name: "Ana" }, wa_id: "573001112233" }],
              messages,
              ...extra,
            },
          },
        ],
      },
    ],
  };
}

describe("069 — WhatsApp", () => {
  it("omite la salud, enmascara los datos y anota las marcas de cada mensaje", () => {
    const original = whatsapp([
      { id: "wamid.1", from: "573001112233", timestamp: "1", type: "text", text: { body: SALUD } },
      {
        id: "wamid.2",
        from: "573001112233",
        timestamp: "2",
        type: "text",
        text: { body: `${CORREO}, cel 3001234567, cédula 1020345678` },
      },
      {
        id: "wamid.3",
        from: "573001112233",
        timestamp: "3",
        type: "image",
        image: { id: "media_1", mime_type: "image/jpeg", caption: SALUD },
      },
    ]);
    const filtrado = filtrarPayload(original, DENTAL) as ReturnType<typeof whatsapp>;
    expect(sinCrudas(filtrado)).toEqual([]);

    const [m1, m2, m3] = filtrado.entry[0]!.changes[0]!.value.messages as Record<string, never>[];
    expect(m1).toMatchObject({ text: { body: HEALTH_OMITTED_TEXT } });
    expect(marcasDe(m1)).toEqual(["salud", "sintoma"]);
    expect(marcasDe(m2)).toEqual(["correo", "telefono", "documento"]);
    expect(m3).toMatchObject({ image: { caption: HEALTH_OMITTED_TEXT, id: "media_1" } });
    expect(marcasDe(m3)).toEqual(["salud", "sintoma"]);
  });

  it("no toca el original (devuelve una copia)", () => {
    const original = whatsapp([
      { id: "wamid.1", timestamp: "1", type: "text", text: { body: SALUD } },
    ]);
    filtrarPayload(original, DENTAL);
    expect(JSON.stringify(original)).toContain(SALUD);
  });

  it("ajuste de Andres: referral.body y un eco con salud quedan intactos; el texto del paciente se omite", () => {
    const original = {
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
                  {
                    id: "wamid.1",
                    from: "573001112233",
                    timestamp: "1",
                    type: "text",
                    text: { body: SALUD },
                    referral: {
                      source_type: "ad",
                      headline: "Sonrisa sana",
                      body: ANUNCIO,
                      ctwa_clid: "clid_1",
                    },
                  },
                ],
              },
            },
            {
              field: "smb_message_echoes",
              value: {
                metadata: { phone_number_id: "pn_1" },
                message_echoes: [
                  {
                    id: "wamid.eco",
                    to: "573001112233",
                    timestamp: "2",
                    type: "image",
                    text: { body: ECO },
                    image: { id: "m2", caption: ECO },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const json = JSON.stringify(filtrarPayload(original, DENTAL));
    expect(json).toContain(ANUNCIO);
    expect(json).toContain(ECO);
    expect(json).not.toContain(SALUD);
    expect(json).toContain(HEALTH_OMITTED_TEXT);
  });

  it("los estados y errores de Meta quedan intactos", () => {
    const original = whatsapp([], {
      statuses: [
        {
          id: "wamid.out",
          status: "failed",
          timestamp: "1",
          errors: [{ code: 131047, title: "Re-engagement message", message: "Message failed" }],
        },
      ],
    });
    expect(filtrarPayload(original, null)).toEqual(original);
  });

  it("sin perfil: el texto no se guarda, el rótulo de un botón sí", () => {
    const filtrado = filtrarPayload(
      whatsapp([
        { id: "wamid.1", timestamp: "1", type: "text", text: { body: "hola" } },
        {
          id: "wamid.2",
          timestamp: "2",
          type: "interactive",
          interactive: {
            type: "button_reply",
            button_reply: { id: "consent:aviso_privacidad:no_acepto", title: "No acepto" },
          },
        },
        { id: "wamid.3", timestamp: "3", type: "button", button: { text: "Acepto", payload: "Acepto" } },
      ]),
      null
    ) as ReturnType<typeof whatsapp>;
    const [m1, m2, m3] = filtrado.entry[0]!.changes[0]!.value.messages as Record<string, never>[];
    expect(m1).toMatchObject({ text: { body: UNREVIEWED_TEXT } });
    expect(marcasDe(m1)).toEqual(["sin_revisar"]);
    expect(m2).toMatchObject({ interactive: { button_reply: { title: "No acepto" } } });
    expect(marcasDe(m2)).toEqual([]);
    expect(m3).toMatchObject({ button: { text: "Acepto" } });
  });

  it("red de seguridad: un campo desconocido con texto también se filtra", () => {
    const filtrado = filtrarPayload(
      whatsapp([
        {
          id: "wamid.1",
          timestamp: "1",
          type: "nuevo_tipo_de_meta",
          nuevo_tipo_de_meta: { text: SALUD, extra: { description: CORREO } },
        },
      ]),
      DENTAL
    );
    expect(sinCrudas(filtrado)).toEqual([]);
  });
});

describe("069 — Meta (Instagram y Messenger)", () => {
  it("filtra lo del paciente y deja intactos los ecos", () => {
    const original = {
      object: "page",
      entry: [
        {
          id: "page_1",
          messaging: [
            { sender: { id: "psid_1" }, message: { mid: "m1", text: SALUD } },
            { sender: { id: "page_1" }, message: { mid: "m2", text: ECO, is_echo: true } },
            {
              sender: { id: "psid_1" },
              message: { mid: "m3", text: "Acepto", quick_reply: { payload: "ACEPTO" } },
            },
          ],
        },
      ],
    };
    const filtrado = filtrarPayload(original, DENTAL) as typeof original;
    const [m1, m2, m3] = filtrado.entry[0]!.messaging;
    expect(m1!.message.text).toBe(HEALTH_OMITTED_TEXT);
    expect(marcasDe(m1!.message)).toEqual(["salud", "sintoma"]);
    expect(m2!.message.text).toBe(ECO);
    expect(marcasDe(m2!.message)).toBeNull();
    expect(m3!.message.text).toBe("Acepto");
  });
});

describe("069 — Zernio", () => {
  it("filtra lo entrante y deja intacto lo saliente", () => {
    const entrante = {
      event: "message.received",
      account: { id: "acc_1", platform: "instagram" },
      message: { id: "zm_1", direction: "incoming", text: SALUD, sender: { id: "ig_1", name: "Ana" } },
    };
    const saliente = { ...entrante, message: { ...entrante.message, direction: "outgoing", text: ECO } };
    const f1 = filtrarPayload(entrante, DENTAL) as typeof entrante;
    expect(f1.message.text).toBe(HEALTH_OMITTED_TEXT);
    expect(marcasDe(f1.message)).toEqual(["salud", "sintoma"]);
    expect(filtrarPayload(saliente, DENTAL)).toEqual(saliente);
  });
});
