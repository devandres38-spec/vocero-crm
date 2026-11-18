import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { archivosTs, leerSinComentarios, rel } from "./helpers/fuentes";

/**
 * 069 (US5, D5, SC-003) — Las rutas que un acceso de soporte de nivel
 * `configuracion` puede MODIFICAR son exactamente estas seis superficies:
 * marca y apariencia, pipeline, agenda, perfil del agente y conocimiento.
 * Agregar una ruta a esta lista es una decisión de producto (y de la Ley
 * 1581), no un detalle de implementación: esta prueba falla hasta que alguien
 * la cambie a propósito.
 */
const ESPERADAS = [
  "src/app/api/agent/profile/route.ts",
  "src/app/api/calendar/settings/route.ts",
  "src/app/api/kb/[id]/route.ts",
  "src/app/api/kb/route.ts",
  "src/app/api/pipeline/stages/[id]/route.ts",
  "src/app/api/pipeline/stages/route.ts",
  "src/app/api/settings/appearance/route.ts",
  "src/app/api/settings/branding/route.ts",
];

const DECLARA = /soporte:\s*"configuracion"/;

describe("069 — rutas que admiten soporte de configuración", () => {
  it("son exactamente las seis superficies acordadas", () => {
    const declaran = archivosTs(join(process.cwd(), "src/app"))
      .filter((f) => DECLARA.test(leerSinComentarios(f)))
      .map(rel)
      .sort();
    expect(declaran).toEqual(ESPERADAS);
  });

  it("ninguna ruta de credenciales, envío, contactos ni equipo lo declara", () => {
    for (const f of archivosTs(join(process.cwd(), "src/app/api"))) {
      const ruta = rel(f);
      if (/\/(settings\/(ai|whatsapp|team|channels|instagram|messenger|tiktok|google|zoom|capi|webhook)|contacts|conversations|messages|leads|import|lab)\b/.test(ruta)) {
        expect(leerSinComentarios(f), ruta).not.toMatch(DECLARA);
      }
    }
  });
});
