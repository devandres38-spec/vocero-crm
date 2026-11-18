import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { archivosTs, leerSinComentarios, rel } from "./helpers/fuentes";

/**
 * 069 (SC-002, constitución I) — «La primera organización» no existe en modo
 * plataforma. Una consulta a `organization` o `member` con `.limit(…)` y sin
 * `.where(…)` devuelve la que Postgres quiera: en `single` es LA organización
 * (hay una), en `multi` es la de otro negocio.
 *
 * Solo pueden hacerlo los archivos de esta lista, y cada uno debe cortar el
 * modo plataforma (`esPlataforma()`) antes de llegar ahí.
 */
const PERMITIDOS_SOLO_SINGLE = new Set([
  "src/server/bot/auth.ts", // resolveInstanceOrg: /api/bot/* (404 en multi)
  "src/server/auth/on-signup.ts", // resolveMembership: la membresía de `single`
  "src/server/branding.ts", // marca sin sesión de `single`
  "src/server/apariencia.ts", // apariencia sin sesión de `single`
]);

const PATRON = /\.from\(schema\.(organization|member)\)([^;]*?)\.limit\(/g;

function sospechosas(codigo: string): string[] {
  const out: string[] = [];
  for (const m of codigo.matchAll(PATRON)) {
    if (!m[2]!.includes(".where(")) out.push(m[0].replace(/\s+/g, " ").slice(0, 120));
  }
  return out;
}

describe("069 — nadie resuelve «la primera organización»", () => {
  const archivos = archivosTs(join(process.cwd(), "src"));

  it("el patrón detecta lo que debe (autoprueba)", () => {
    expect(sospechosas("db.select().from(schema.organization).limit(1);")).toHaveLength(1);
    expect(
      sospechosas("db.select().from(schema.member).where(eq(a, b)).limit(1);")
    ).toHaveLength(0);
  });

  it("fuera de la lista de `single`, ninguna consulta sin filtro", () => {
    const hallazgos: string[] = [];
    for (const f of archivos) {
      const ruta = rel(f);
      if (PERMITIDOS_SOLO_SINGLE.has(ruta)) continue;
      for (const s of sospechosas(leerSinComentarios(f))) hallazgos.push(`${ruta}: ${s}`);
    }
    expect(hallazgos).toEqual([]);
  });

  it("cada archivo permitido corta el modo plataforma", () => {
    for (const ruta of PERMITIDOS_SOLO_SINGLE) {
      const codigo = leerSinComentarios(join(process.cwd(), ruta));
      expect(codigo, ruta).toMatch(/esPlataforma\(\)/);
    }
  });
});
