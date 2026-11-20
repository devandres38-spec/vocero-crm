import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { armarEvento, replyToTexto, tarjetasDe } from "@/server/brains/contract";
import { mediaLabel } from "@/components/inbox/helpers";
import { idiomaDePlantillaPara } from "@/lib/template-languages";
import { hora12, hora12InTz, labelInTz } from "@/lib/time/slots";
import { formatPhone } from "@/lib/utils";

/** 073-C — Calidad conversacional y Colombia (lado CRM). */

const leer = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

const BASE = {
  dispatchId: "dsp_1",
  organization: { id: "org_1", slug: "acme" },
  conversation: { id: "cv_1", channel: "whatsapp" as const, aiEnabled: true, windowOpen: true, windowExpiresAt: null },
  contact: { id: "ct_1", displayName: "Ana", identity: "573001112233" },
  firstMessageAt: new Date("2026-11-20T10:00:00Z"),
  lastMessageAt: new Date("2026-11-20T10:00:00Z"),
};

describe("evento de despacho: replyTo y teléfonos (aditivos)", () => {
  it("sin cita ni tarjetas, el cuerpo es el de siempre (mismas llaves, mismo orden)", () => {
    const e = armarEvento({
      ...BASE,
      messages: [{ id: "m1", createdAt: new Date("2026-11-20T10:00:00Z"), type: "text", text: "hola", media: null }],
    });
    expect(Object.keys(e.messages[0]!)).toEqual(["id", "at", "type", "text", "mediaId"]);
  });

  it("con cita, `replyTo` va al final del mensaje", () => {
    const e = armarEvento({
      ...BASE,
      messages: [
        {
          id: "m1",
          createdAt: new Date("2026-11-20T10:00:00Z"),
          type: "text",
          text: "ese",
          media: null,
          replyTo: { id: "msg_0", author: "negocio", type: "text", text: "¿martes o jueves?" },
        },
      ],
    });
    expect(Object.keys(e.messages[0]!).at(-1)).toBe("replyTo");
    expect(e.messages[0]!.replyTo).toEqual({ id: "msg_0", author: "negocio", type: "text", text: "¿martes o jueves?" });
  });

  it("las tarjetas traen sus teléfonos (y sin teléfonos, solo el nombre)", () => {
    const payload = [
      { name: { formatted_name: "Luis Pérez" }, phones: [{ phone: "+57 300 111 2233", wa_id: "573001112233" }] },
      { name: { first_name: "Sofi" } },
      { name: {} },
    ];
    expect(tarjetasDe(payload)).toEqual([
      { name: "Luis Pérez", phones: ["+57 300 111 2233"] },
      { name: "Sofi", phones: [] },
    ]);
    const e = armarEvento({
      ...BASE,
      messages: [
        {
          id: "m2",
          createdAt: new Date("2026-11-20T10:00:00Z"),
          type: "contacts",
          text: null,
          media: { waMediaId: null, mimeType: null, caption: null, payload },
        },
      ],
    });
    expect(e.messages[0]!.contacts).toEqual([{ name: "Luis Pérez", phones: ["+57 300 111 2233"] }, { name: "Sofi" }]);
  });
});

describe("parche final de la auditoría 073-C", () => {
  it("un teléfono vacío no tapa al wa_id y se acota a 40", () => {
    const payload = [
      { name: { formatted_name: "Luis" }, phones: [{ phone: "   ", wa_id: "573001112233" }, { phone: "9".repeat(80) }] },
    ];
    expect(tarjetasDe(payload)).toEqual([{ name: "Luis", phones: ["573001112233", "9".repeat(40)] }]);
  });

  it("replyTo de una foto con pie usa el caption", () => {
    expect(replyToTexto(null, "así quedó")).toEqual({ text: "así quedó" });
    expect(replyToTexto("  ", "pie")).toEqual({ text: "pie" });
    expect(replyToTexto("hola", "pie")).toEqual({ text: "hola" });
    expect(replyToTexto(null, null)).toEqual({ text: null });
    expect(replyToTexto(null, "x".repeat(900)).text).toHaveLength(500);
    const deliver = leer("src", "server", "brains", "deliver.ts");
    expect(deliver).toMatch(/leftJoin\(schema\.mediaAsset/);
    expect(deliver).toMatch(/replyToTexto\(c\.text, c\.caption\)/);
  });

  it("la reacción tiene etiqueta en la bandeja", () => {
    expect(mediaLabel("reaction")).toBe("Reacción");
  });

  it("la hora de las citas en contexto va en 12 h", () => {
    expect(hora12InTz("2026-11-23T20:30:00Z", "America/Bogota", "es-CO")).toBe("3:30 p. m.");
    expect(hora12InTz("2026-11-23T05:05:00Z", "America/Bogota", "es-CO")).toBe("12:05 a. m.");
    expect(hora12InTz("2026-11-23T20:30:00Z", "America/Bogota", "en-US")).toBe("3:30 PM");
    expect(hora12InTz("no-es-fecha", "America/Bogota")).toBe("");
  });
});

describe("reacciones: a la bandeja, sin turno", () => {
  it("la ingesta las guarda sin despacho ni ventana y la ráfaga no las lleva", () => {
    const ingest = leer("src", "server", "inbox", "ingest.ts");
    expect(ingest).toMatch(/if \(msg\.type === "reaction"\)/);
    expect(ingest).toMatch(/despachar: false/);
    expect(ingest).toMatch(/\.\.\.\(esTurno \? \{ lastInboundAt: waTimestamp \} : \{\}\)/);
    expect(ingest).toMatch(/if \(!esTurno\) return;/);
    expect(leer("src", "server", "brains", "deliver.ts")).toMatch(/m\.type !== "reaction"/);
  });
});

describe("Colombia", () => {
  it("idioma de plantilla según la región", () => {
    expect(idiomaDePlantillaPara("es-CO")).toBe("es_CO");
    expect(idiomaDePlantillaPara("es-PE")).toBe("es_PE");
    expect(idiomaDePlantillaPara("pt-BR")).toBe("pt_BR");
    expect(idiomaDePlantillaPara("es-ZZ")).toBe("es");
    expect(idiomaDePlantillaPara(null)).toBe("es_CO");
  });

  it("teléfonos legibles", () => {
    expect(formatPhone("573001234567")).toBe("+57 300 1234567");
    expect(formatPhone("525512345678")).toMatch(/^\+52 55/);
    expect(formatPhone(null)).toBe("Sin teléfono");
    expect(formatPhone("123")).toBe("+123");
  });

  it("12 h solo en presentación", () => {
    expect(hora12(15, "00")).toBe("3:00 p. m.");
    expect(hora12(0, "30")).toBe("12:30 a. m.");
    expect(hora12(12, "05")).toBe("12:05 p. m.");
    const etiqueta = labelInTz("2026-11-23T20:30:00Z", "America/Bogota", "es-CO");
    expect(etiqueta).toMatch(/3:30 p\. m\.$/);
  });

  it("textos de la UI sin mexicanismos ni placeholders de otro país", () => {
    const archivos = [
      ["src", "components", "pipeline", "amount-dialog.tsx"],
      ["src", "components", "pipeline", "lead-drawer.tsx"],
      ["src", "components", "bookings", "block-dialog.tsx"],
      ["src", "components", "settings", "templates-client.tsx"],
      ["src", "components", "contacts", "import-contacts-dialog.tsx"],
      ["src", "components", "contacts", "new-contact-dialog.tsx"],
    ];
    const ui = archivos.map((a) => leer(...a)).join("\n");
    for (const malo of ['placeholder="12,500', "Comida con proveedor", "lugares disponibles", "capturar contactos", "Renglón {p.line}", '"No se entiende ese importe."']) {
      expect(ui).not.toContain(malo);
    }
    expect(ui).toContain('placeholder="150.000"');
    expect(ui).toContain("cupos disponibles");
  });

  it("ninguna fecha de la app se formatea con el idioma del navegador", () => {
    const sinRegion = [
      "plataforma/acciones-organizacion.tsx",
      "plataforma/enlace-una-vez.tsx",
      "plataforma/gestor-cerebros.tsx",
      "plataforma/gestor-soporte.tsx",
      "plataforma/gestor-tokens.tsx",
      "plataforma/visor-auditoria.tsx",
      "settings/accesos-soporte.tsx",
      "settings/ads-client.tsx",
      "settings/cambios-plataforma.tsx",
    ].map((f) => leer("src", "components", ...f.split("/")));
    for (const fuente of sinRegion) {
      expect(fuente).not.toMatch(/toLocaleString\(undefined|toLocaleString\(\)/);
    }
  });
});
