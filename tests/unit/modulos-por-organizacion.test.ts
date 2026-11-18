import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { archivosTs, leerSinComentarios, rel } from "./helpers/fuentes";

/**
 * 069 (D11, FR-015, SC-002) — Las banderas de instancia (`AGENDA`,
 * `ATRIBUCION`, `CHANNELS`) son el TECHO. Donde hay organización, se pregunta
 * por el módulo de ESA organización (`src/server/modulos/consulta.ts`): si no,
 * un negocio con la agenda apagada la vería igual porque la instancia la
 * tiene.
 *
 * Solo pueden leer el techo directamente los archivos de esta lista, cada uno
 * con su porqué.
 */
const PERMITIDOS: Record<string, string> = {
  "src/server/agenda/flag.ts": "define el techo",
  "src/server/attribution/flag.ts": "define el techo",
  "src/server/channels/enabled.ts": "define el techo",
  "src/server/modulos/efectivos.ts": "calcula techo ∧ organización",
  "src/app/layout.tsx": "nombre del producto sin sesión",
  "src/app/manifest.ts": "nombre del producto sin sesión",
  "src/app/(auth)/layout.tsx": "nombre del producto sin sesión",
  "src/server/zernio/conexiones.ts": "URLs del webhook de la instancia (las conexiones por organización ya filtran)",
  "src/server/zernio/dispatch.ts": "puerta de instancia antes de saber la organización; la ingesta filtra por organización",
  "src/server/attribution/store.ts": "valor por defecto de funciones puras; los llamadores pasan el de la organización",
  "src/server/analytics/bot.ts": "valor por defecto de una función pura; la ruta pasa el de la organización",
};

/** Superficies que existen sin organización: el techo es lo único que hay. */
const PREFIJOS_PERMITIDOS = [
  "src/app/api/bot/", // `single` únicamente (404 en `multi`)
  "src/app/api/webhooks/", // puerta de instancia; la organización se filtra en la ingesta
];

const PATRON = /\b(agendaEnabled|atribucionEnabled|enabledChannels)\(\)|\bisChannelEnabled\(/g;

describe("069 — módulos por organización, no por instancia", () => {
  it("fuera de la lista, nadie consulta el techo directamente", () => {
    const hallazgos: string[] = [];
    for (const f of archivosTs(join(process.cwd(), "src"))) {
      const ruta = rel(f);
      if (PERMITIDOS[ruta] || PREFIJOS_PERMITIDOS.some((p) => ruta.startsWith(p))) continue;
      const codigo = leerSinComentarios(f);
      for (const m of codigo.matchAll(PATRON)) hallazgos.push(`${ruta}: ${m[0]}`);
    }
    expect(hallazgos).toEqual([]);
  });

  it("la lista no tiene entradas muertas", () => {
    for (const ruta of Object.keys(PERMITIDOS)) {
      expect(leerSinComentarios(join(process.cwd(), ruta)), ruta).toMatch(PATRON);
    }
  });

  it("la ingesta descarta un canal apagado en la organización", () => {
    const ingesta = leerSinComentarios(join(process.cwd(), "src/server/inbox/ingest.ts"));
    expect(ingesta).toMatch(/modulosDeOrganizacion\(organizationId\)\)\.channels\.includes\(canal\)/);
  });
});
