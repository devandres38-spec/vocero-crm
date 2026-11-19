import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 072-B (B1, T055) — El marco de módulos aislados:
 *
 * - el catálogo es coherente (claves, menú bajo `/m/<clave>`, piezas de
 *   cliente registradas, herramientas válidas para el puente);
 * - guardarraíles de código: toda carpeta `m/*` tiene su guarda, toda API
 *   `api/m/*` va con `withModulo`, y el núcleo no importa `src/modulos/*`
 *   fuera de los registros;
 * - la experiencia suma los aportes de los módulos ENCENDIDOS y nada más;
 * - las puertas: módulo apagado = 404, y la organización sale de la sesión
 *   (A ↛ B en `/m/*` y `/api/m/*`).
 */

const h = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  marcas: vi.fn(),
  fila: null as null | Record<string, unknown>,
}));

vi.mock("next/navigation", () => ({
  redirect: (p: string) => {
    throw new Error(`redirect:${p}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  getSessionOrNull: async () => h.session,
  requireSession: async () => {
    const { UnauthorizedError } = await original<typeof import("@/lib/auth/session")>();
    if (!h.session) throw new UnauthorizedError();
    return h.session;
  },
  contextoActual: async () => ({ tipo: "negocio" }),
  destinoSinOrganizacion: () => "/login",
}));
vi.mock("@/modulos/diagnostico/consultas", () => ({ marcasDeConversacion: h.marcas, ultimasMarcas: async () => [] }));
vi.mock("@/lib/db", async (original) => {
  const real = await original<typeof import("@/lib/db")>();
  const select = () => {
    const b: Record<string, unknown> = {
      from: () => b,
      where: () => b,
      limit: () => Promise.resolve(h.fila ? [h.fila] : []),
    };
    return b;
  };
  return { ...real, getDb: () => ({ select }) };
});

import { CLAVES_MODULO, MODULOS, widgetDeModulo } from "@/modulos/catalogo";
import { HERRAMIENTAS_POR_MODULO } from "@/modulos/registro";
import { CLAVE_APORTE_RE, CLAVE_MODULO_RE } from "@/modulos/tipos";
import { motivoInvalida } from "@/server/brains/herramientas";
import {
  CATALOGO_VERTICAL,
  modulosEfectivos,
  modulosOrganizacionSchema,
  type TechoInstancia,
} from "@/server/modulos/efectivos";
import { exigirModulo, moduloActivo, withModulo } from "@/server/modulos/guardas";
import { aportesDeModulos, EXPERIENCIA_DEFAULT, resolverExperiencia } from "@/verticals/resolver";
import { appNavGroups } from "@/lib/nav";
import { widgetsVisibles } from "@/components/inicio/widgets";
import { experienciaDe } from "@/server/verticals/experiencia";
import { GET as marcasRuta } from "@/app/api/m/diagnostico/marcas/route";
import DiagnosticoLayout from "@/app/(app)/m/diagnostico/layout";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const SRC = path.join(RAIZ, "src");

function archivos(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(archivos(p));
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(RAIZ, p).split(path.sep).join("/");
const imports = (codigo: string) => [...codigo.matchAll(/from\s+"(@\/modulos\/[^"]+)"|import\(\s*"(@\/modulos\/[^"]+)"\s*\)/g)].map((m) => m[1] ?? m[2]!);

const sesion = (modules: string[], organizationId = "org_A") => ({
  userId: "u_1",
  organizationId,
  role: "owner",
  via: "miembro",
  modulos: { agenda: false, atribucion: false, channels: ["whatsapp"], modules },
});

beforeEach(() => {
  h.session = null;
  h.marcas.mockReset();
  h.fila = null;
  vi.unstubAllEnvs();
});

describe("el catálogo de módulos", () => {
  it("claves válidas, menú bajo /m/<clave> y aportes con clave válida", () => {
    expect(CLAVES_MODULO).toEqual(["diagnostico"]);
    for (const m of MODULOS) {
      expect(m.clave).toMatch(CLAVE_MODULO_RE);
      for (const e of m.nav) expect(e.href === `/m/${m.clave}` || e.href.startsWith(`/m/${m.clave}/`), e.href).toBe(true);
      for (const a of [...m.widgets, ...m.seccionesFicha]) expect(a.clave).toMatch(CLAVE_APORTE_RE);
    }
  });

  it("`diagnostico` es oculto (solo la agencia lo enciende)", () => {
    expect(MODULOS.find((m) => m.clave === "diagnostico")!.oculto).toBe(true);
  });

  it("cada widget y sección declarados están en `registro-cliente`, y viceversa", () => {
    const cliente = readFileSync(path.join(SRC, "modulos", "registro-cliente.tsx"), "utf8");
    const enCliente = [...cliente.matchAll(/^\s+"([a-z0-9]+\.[a-z0-9_]+)":\s*dynamic\(/gm)].map((m) => m[1]).sort();
    const declarados = MODULOS.flatMap((m) => [...m.widgets, ...m.seccionesFicha].map((a) => `${m.clave}.${a.clave}`)).sort();
    expect(enCliente).toEqual(declarados);
    // Y siempre con `next/dynamic`: nada de importar la pieza directamente.
    expect(cliente).not.toMatch(/^import .* from "@\/modulos\/(?!tipos)/m);
  });

  it("cada herramienta registrada pasa las reglas del puente (prefijo, reservados, tamaños)", () => {
    for (const [modulo, tools] of Object.entries(HERRAMIENTAS_POR_MODULO)) {
      expect(CLAVES_MODULO).toContain(modulo);
      for (const t of tools) expect(motivoInvalida(modulo, t), t.nombre).toBeNull();
    }
  });

  it("`CATALOGO_VERTICAL` sale del registro: `diagnostico` se acepta, lo desconocido no", () => {
    expect([...CATALOGO_VERTICAL]).toEqual([...CLAVES_MODULO]);
    expect(modulosOrganizacionSchema.safeParse({ modules: ["diagnostico"] }).success).toBe(true);
    expect(modulosOrganizacionSchema.safeParse({ modules: ["clinica"] }).success).toBe(false);
    const techo: TechoInstancia = { agenda: false, atribucion: false, channels: new Set() };
    expect(modulosEfectivos(techo, { modules: ["diagnostico", "x"] }).modules).toEqual(["diagnostico"]);
    // Sin pedirlo, ningún módulo: se encienden explícitamente.
    expect(modulosEfectivos(techo, null).modules).toEqual([]);
  });
});

describe("guardarraíl: rutas de módulo", () => {
  const paginas = path.join(SRC, "app", "(app)", "m");
  const apis = path.join(SRC, "app", "api", "m");

  it("cada carpeta `(app)/m/<clave>` es de un módulo del catálogo y su layout exige ESE módulo", () => {
    const dirs = readdirSync(paginas).filter((d) => statSync(path.join(paginas, d)).isDirectory());
    expect(dirs.length).toBeGreaterThan(0);
    for (const d of dirs) {
      expect(CLAVES_MODULO, d).toContain(d);
      const layout = readFileSync(path.join(paginas, d, "layout.tsx"), "utf8");
      expect(layout, d).toContain(`await exigirModulo("${d}")`);
    }
    // Nada suelto en `m/` fuera de carpetas de módulo.
    expect(readdirSync(paginas).filter((e) => !statSync(path.join(paginas, e)).isDirectory())).toEqual([]);
  });

  it("cada `api/m/<clave>/**/route.ts` exporta SOLO manejadores envueltos con `withModulo(\"<clave>\"`", () => {
    const rutas = archivos(apis).filter((f) => f.endsWith("route.ts"));
    expect(rutas.length).toBeGreaterThan(0);
    for (const f of rutas) {
      const clave = rel(f).split("/")[4]!;
      expect(CLAVES_MODULO, rel(f)).toContain(clave);
      const codigo = readFileSync(f, "utf8");
      const metodos = [...codigo.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\s*=\s*([^\n]+)/g)];
      expect(metodos.length, rel(f)).toBeGreaterThan(0);
      for (const m of metodos) expect(m[2], `${rel(f)} ${m[1]}`).toMatch(new RegExp(`^withModulo\\("${clave}",`));
      expect(codigo, rel(f)).not.toMatch(/export (async )?function (GET|POST|PUT|PATCH|DELETE)/);
    }
  });

  it("el núcleo solo importa los registros de `src/modulos/` (y `registro` solo el puente)", () => {
    const permitidos = new Set(["@/modulos/catalogo", "@/modulos/tipos", "@/modulos/registro-cliente"]);
    const delModulo = (f: string) =>
      f.startsWith("src/modulos/") || f.startsWith("src/app/(app)/m/") || f.startsWith("src/app/api/m/");
    const vistos = new Set<string>();
    for (const f of archivos(SRC)) {
      const r = rel(f);
      if (delModulo(r)) continue;
      for (const i of imports(readFileSync(f, "utf8"))) {
        vistos.add(i);
        if (i === "@/modulos/registro") expect(r, `${r} → ${i}`).toBe("src/server/brains/herramientas.ts");
        else expect(permitidos.has(i), `${r} importa ${i}`).toBe(true);
      }
    }
    // El escaneo encuentra los usos reales (si no, la prueba pasaría en vacío).
    expect([...vistos].sort()).toEqual(["@/modulos/catalogo", "@/modulos/registro", "@/modulos/registro-cliente", "@/modulos/tipos"]);
  });

  it("un módulo no importa a otro módulo", () => {
    for (const f of archivos(path.join(SRC, "modulos"))) {
      const r = rel(f);
      const propio = r.split("/")[2]!;
      if (!CLAVES_MODULO.includes(propio)) continue; // los registros
      for (const i of imports(readFileSync(f, "utf8"))) {
        const otro = i.split("/")[2]!.replace(/\.tsx?$/, "");
        if (["tipos", "catalogo", "registro", "registro-cliente"].includes(otro)) continue;
        expect(otro, `${r} → ${i}`).toBe(propio);
      }
    }
  });
});

describe("la experiencia con módulos", () => {
  it("aporta menú y secciones solo de los módulos pedidos que existen, una vez", () => {
    expect(aportesDeModulos(["diagnostico", "diagnostico", "mobiliario"])).toEqual({
      claves: ["diagnostico"],
      nav: [{ href: "/m/diagnostico", label: "Diagnóstico", icono: "modulo" }],
      seccionesFicha: [{ clave: "marcas", titulo: "Diagnóstico", modulo: "diagnostico" }],
    });
    expect(EXPERIENCIA_DEFAULT.modulos).toEqual({ claves: [], nav: [], seccionesFicha: [] });
  });

  it("el menú suma la entrada del módulo encendido al grupo Trabajo; un override la puede ocultar", () => {
    const hrefs = (exp: ReturnType<typeof resolverExperiencia>) =>
      appNavGroups({ role: "owner", experiencia: exp }).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs(resolverExperiencia("default", null))).not.toContain("/m/diagnostico");
    const con = appNavGroups({ role: "owner", experiencia: resolverExperiencia("default", null, ["diagnostico"]) });
    expect(con[0]!.items.map((i) => i.href)).toEqual(["/inbox", "/pipeline", "/contacts", "/m/diagnostico"]);
    expect(hrefs(resolverExperiencia("default", { nav: { ocultas: ["/m/diagnostico"] } }, ["diagnostico"]))).not.toContain("/m/diagnostico");
  });

  it("un widget de módulo se pinta solo con su módulo encendido y si lo declara", () => {
    const ws = [{ tipo: "diagnostico.estado" }, { tipo: "diagnostico.nada" }, { tipo: "mobiliario.cotizaciones" }, { tipo: "sin_responder" }] as const;
    expect(widgetsVisibles([...ws], false, ["diagnostico"])).toEqual([{ tipo: "diagnostico.estado" }, { tipo: "sin_responder" }]);
    expect(widgetsVisibles([...ws], false, [])).toEqual([{ tipo: "sin_responder" }]);
    expect(widgetDeModulo("diagnostico.estado")).toEqual({ clave: "estado", titulo: "Diagnóstico", modulo: "diagnostico" });
  });

  it("`experienciaDe` en multi lee los módulos de la MISMA fila; en single, ninguno", async () => {
    vi.stubEnv("TENANCY", "multi");
    h.fila = { verticalPack: "default", verticalOverrides: null, modules: { modules: ["diagnostico"] } };
    expect((await experienciaDe("org_multi_1")).modulos.claves).toEqual(["diagnostico"]);
    vi.stubEnv("TENANCY", "single");
    expect((await experienciaDe("org_single_1")).modulos.claves).toEqual([]);
  });
});

describe("las puertas de `/m/*` y `/api/m/*`", () => {
  it("`moduloActivo`: techo ∧ organización; sin módulos en la sesión, el techo (ninguno)", () => {
    expect(moduloActivo(sesion(["diagnostico"]) as never, "diagnostico")).toBe(true);
    expect(moduloActivo(sesion([]) as never, "diagnostico")).toBe(false);
    expect(moduloActivo({} as never, "diagnostico")).toBe(false);
  });

  it("el layout de /m/diagnostico: 404 sin el módulo, a /login sin sesión, pasa con él", async () => {
    await expect(DiagnosticoLayout({ children: null })).rejects.toThrow("redirect:/login");
    h.session = sesion([]);
    await expect(DiagnosticoLayout({ children: null })).rejects.toThrow("notFound");
    h.session = sesion(["diagnostico"]);
    await expect(DiagnosticoLayout({ children: "ok" })).resolves.toBe("ok");
    await expect(exigirModulo("diagnostico")).resolves.toMatchObject({ organizationId: "org_A" });
  });

  it("la API con el módulo apagado: 404 sin cuerpo y sin consultar", async () => {
    h.session = sesion([]);
    const r = await marcasRuta(new Request("http://x.test/api/m/diagnostico/marcas?conversationId=cv_1"));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("");
    expect(h.marcas).not.toHaveBeenCalled();
  });

  it("sin sesión, 401 como cualquier API", async () => {
    const r = await marcasRuta(new Request("http://x.test/api/m/diagnostico/marcas?conversationId=cv_1"));
    expect(r.status).toBe(401);
  });

  it("A ↛ B: con el módulo, la consulta va con la organización de la SESIÓN", async () => {
    h.session = sesion(["diagnostico"], "org_A");
    h.marcas.mockResolvedValue({ total: 0, ultima: null });
    const r = await marcasRuta(new Request("http://x.test/api/m/diagnostico/marcas?conversationId=cv_de_B"));
    expect(r.status).toBe(200);
    expect(h.marcas).toHaveBeenCalledWith("org_A", "cv_de_B");
    const sinId = await marcasRuta(new Request("http://x.test/api/m/diagnostico/marcas"));
    expect(sinId.status).toBe(422);
  });

  it("`withModulo` no llama al manejador con el módulo apagado", async () => {
    const manejador = vi.fn(async () => new Response("ok"));
    const ruta = withModulo("diagnostico", manejador);
    h.session = sesion([]);
    expect((await ruta()).status).toBe(404);
    expect(manejador).not.toHaveBeenCalled();
    h.session = sesion(["diagnostico"]);
    expect(await (await ruta()).text()).toBe("ok");
  });
});
