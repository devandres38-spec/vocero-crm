import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";
import { z } from "zod";

/**
 * 072-B (B2, T062) — El puente `POST /api/brains/tools/{name}` y el anuncio
 * `moduleTools`: cada código del contrato brains-072 §4, módulo apagado =
 * inexistente, A↛B, idempotencia (repetición, en curso, fallida reintenta),
 * tiempo límite con `AbortSignal` y resultado de más de 4 KB.
 *
 * La base es falsa pero CON ESTADO para `brain_tool_call` (se evalúan los
 * parámetros del WHERE), así que la idempotencia se prueba de verdad entre
 * llamadas sucesivas.
 */

type Fila = {
  id: string;
  organizationId: string;
  conversationId: string;
  dispatchId: string;
  tool: string;
  idempotencyKey: string;
  estado: "en_curso" | "hecha" | "fallida";
  response: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const h = vi.hoisted(() => ({
  conv: null as null | { aiEnabled: boolean; handoffAt: Date | null },
  filas: [] as Fila[],
  notas: [] as Record<string, unknown>[],
  consultas: [] as { tabla: string; params: unknown[] }[],
  modulos: ["diagnostico"] as string[],
  modulosPedidos: [] as string[],
  extra: {} as Record<string, unknown[]>,
  publish: vi.fn(),
  borrados: [] as unknown[][],
  fecha: (_: unknown[]) => undefined as Date | undefined,
}));

vi.mock("@/lib/db", async (original) => {
  const real = await original<typeof import("@/lib/db")>();
  const dialecto = new PgDialect();
  const nombre = (t: unknown) => {
    try {
      return getTableName(t as never);
    } catch {
      return String(t);
    }
  };
  const params = (c: SQL | undefined) => (c ? dialecto.sqlToQuery(c).params : []);
  // Un `timestamp` viaja como texto ISO en los parámetros del SQL.
  const fecha = (ps: unknown[]) => {
    const p = ps.find((x) => x instanceof Date || (typeof x === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:/.test(x)));
    return p === undefined ? undefined : new Date(p as string);
  };
  h.fecha = fecha;

  const select = () => {
    let tabla = "";
    let ps: unknown[] = [];
    const responder = (): unknown[] => {
      if (tabla === "conversation") return h.conv ? [h.conv] : [];
      if (tabla === "brain_tool_call") {
        return h.filas.filter((f) => ps.includes(f.organizationId) && ps.includes(f.idempotencyKey));
      }
      return [];
    };
    const b: Record<string, unknown> = {
      from(t: unknown) {
        tabla = nombre(t);
        return b;
      },
      where(c: SQL | undefined) {
        ps = params(c);
        h.consultas.push({ tabla, params: ps });
        return b;
      },
      orderBy: () => b,
      limit: () => Promise.resolve(responder()),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(responder()).then(ok, ko),
    };
    return b;
  };

  const insert = (t: unknown) => ({
    values(v: Record<string, unknown>) {
      const tabla = nombre(t);
      if (tabla === "conversation_note") {
        const fila = { ...v, createdAt: new Date("2026-11-19T12:00:00Z") };
        h.notas.push(fila);
        return { returning: () => Promise.resolve([fila]) };
      }
      return {
        onConflictDoNothing: () => ({
          returning: () => {
            const choca = h.filas.some((f) => f.organizationId === v.organizationId && f.idempotencyKey === v.idempotencyKey);
            if (choca) return Promise.resolve([]);
            const ahora = new Date();
            h.filas.push({ ...(v as unknown as Fila), response: null, createdAt: ahora, updatedAt: ahora });
            return Promise.resolve([{ id: v.id }]);
          },
        }),
      };
    },
  });

  const update = (_t: unknown) => ({
    set(v: Partial<Fila>) {
      return {
        where(c: SQL | undefined) {
          const ps = params(c);
          const fila = h.filas.find((f) => ps.includes(f.id) && ps.includes(f.organizationId));
          // La toma condicional (`fallida` o `en_curso` vencida) trae fecha.
          const condicional = ps.includes("fallida") && ps.includes("en_curso");
          const corte = fecha(ps);
          const puede =
            fila &&
            (!condicional || fila.estado === "fallida" || (fila.estado === "en_curso" && corte && fila.updatedAt < corte));
          if (puede && fila) Object.assign(fila, v);
          const res = puede && fila ? [{ id: fila.id }] : [];
          return Object.assign(Promise.resolve(res), { returning: () => Promise.resolve(res) });
        },
      };
    },
  });

  const del = (_t: unknown) => ({
    where(c: SQL | undefined) {
      h.borrados.push(params(c));
      return { returning: () => Promise.resolve([{ id: "btc_viejo" }]) };
    },
  });

  const db = { select, insert, update, delete: del };
  return { ...real, getDb: () => db };
});

vi.mock("@/server/modulos/consulta", async (original) => ({
  ...(await original<typeof import("@/server/modulos/consulta")>()),
  modulosDeOrganizacion: async (org: string) => {
    h.modulosPedidos.push(org);
    return { agenda: false, atribucion: false, channels: ["whatsapp"], modules: h.modulos };
  },
}));

vi.mock("@/server/events/bus", () => ({ publish: h.publish }));

vi.mock("@/modulos/registro", async (original) => {
  const real = await original<typeof import("@/modulos/registro")>();
  return {
    ...real,
    herramientasDe: (clave: string) => [...real.herramientasDe(clave), ...((h.extra[clave] ?? []) as never[])],
  };
});

import {
  claveIdempotencia,
  cuerpoDe,
  ejecutarLlamada,
  herramientasEfectivas,
  jsonCanonico,
  motivoInvalida,
  moduleToolsDe,
  RESERVADOS,
  TOPE_HERRAMIENTAS,
} from "@/server/brains/herramientas";
import { purgarLlamadasViejas, RETENCION_LLAMADAS_MS } from "@/server/brains/llamadas-retencion";
import { defineHerramienta, type ModuleTool } from "@/modulos/tipos";

const ORG = "org_A";

function req(cuerpo: unknown, crudo?: string): Request {
  return new Request("http://plataforma.test/api/brains/tools/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: crudo ?? JSON.stringify(cuerpo),
  });
}

const llamar = (nombre: string, cuerpo: unknown, opciones?: Parameters<typeof ejecutarLlamada>[3]) =>
  ejecutarLlamada(req(cuerpo), ORG, nombre, opciones);

const marca = (args: unknown = { motivo: "prueba" }, dispatchId = "dsp_1") => ({
  conversationId: "cv_1",
  dispatchId,
  args,
});

function herramienta(nombre: string, ejecutar: ModuleTool["ejecutar"], efecto: "lectura" | "escritura" = "escritura"): ModuleTool {
  return defineHerramienta({
    nombre,
    descripcion: "Prueba.",
    args: z.object({}).strict(),
    efecto,
    ejecutar,
  }) as ModuleTool;
}

beforeEach(() => {
  h.conv = { aiEnabled: true, handoffAt: null };
  h.filas.length = 0;
  h.notas.length = 0;
  h.consultas.length = 0;
  h.modulos = ["diagnostico"];
  h.modulosPedidos.length = 0;
  h.extra = {};
  h.borrados.length = 0;
  h.publish.mockReset();
});

describe("el anuncio (`moduleTools`)", () => {
  it("con `diagnostico` encendido: sus 2 herramientas con JSON Schema sin `$schema`", async () => {
    const tools = await moduleToolsDe(ORG);
    expect(tools.map((t) => [t.name, t.module, t.effect])).toEqual([
      ["diagnostico_eco", "diagnostico", "lectura"],
      ["diagnostico_marca", "diagnostico", "escritura"],
    ]);
    expect(tools[0]!.parameters).toEqual({
      type: "object",
      properties: { texto: { type: "string", minLength: 1, maxLength: 200 } },
      required: ["texto"],
      additionalProperties: false,
    });
    expect(h.modulosPedidos).toEqual([ORG]);
  });

  it("módulo apagado o desconocido: nada", async () => {
    h.modulos = [];
    expect(await moduleToolsDe(ORG)).toEqual([]);
    expect(herramientasEfectivas(["mobiliario"])).toEqual([]);
  });

  it("descarta nombres sin prefijo, reservados o con patrón inválido, y esquemas grandes", () => {
    const vacia = (nombre: string) => herramienta(nombre, async () => ({ ok: true, result: {} }));
    expect(motivoInvalida("diagnostico", vacia("otro_eco"))).toBe("sin_prefijo_del_modulo");
    expect(motivoInvalida("diagnostico", vacia("Diagnostico_x"))).toBe("nombre_invalido");
    for (const r of RESERVADOS) expect(motivoInvalida(r.split("_")[0]!, vacia(r)), r).not.toBeNull();
    const grande = defineHerramienta({
      nombre: "diagnostico_grande",
      descripcion: "x",
      args: z.object({ a: z.string().describe("x".repeat(5000)) }),
      efecto: "lectura",
      ejecutar: async () => ({ ok: true, result: {} }),
    }) as ModuleTool;
    expect(motivoInvalida("diagnostico", grande)).toBe("esquema_grande");
  });

  it("como mucho 8 por negocio", () => {
    h.extra.diagnostico = Array.from({ length: 10 }, (_, i) => herramienta(`diagnostico_extra${i}`, async () => ({ ok: true, result: {} })));
    expect(herramientasEfectivas(["diagnostico"])).toHaveLength(TOPE_HERRAMIENTAS);
  });
});

describe("la clave de idempotencia", () => {
  it("no depende del orden de las claves y sí del despacho, el nombre y los argumentos", () => {
    expect(jsonCanonico({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}');
    const k = claveIdempotencia("dsp_1", "diagnostico_marca", { a: 1, b: 2 });
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(claveIdempotencia("dsp_1", "diagnostico_marca", { b: 2, a: 1 })).toBe(k);
    expect(claveIdempotencia("dsp_2", "diagnostico_marca", { a: 1, b: 2 })).not.toBe(k);
    expect(claveIdempotencia("dsp_1", "diagnostico_eco", { a: 1, b: 2 })).not.toBe(k);
    expect(claveIdempotencia("dsp_1", "diagnostico_marca", { a: 1, b: 3 })).not.toBe(k);
  });
});

describe("POST /api/brains/tools/{name}: códigos del contrato", () => {
  it("un nombre fuera de patrón y uno inexistente dan el MISMO 404 `tool_not_found`", async () => {
    const malo = await llamar("../etc", marca());
    const inexistente = await llamar("diagnostico_nada", marca());
    expect(malo.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(await malo.json()).toEqual(await inexistente.json());
  });

  it("módulo apagado = inexistente (mismo cuerpo), sin buscar la conversación", async () => {
    const existe = await (await llamar("diagnostico_nada", marca())).json();
    h.modulos = [];
    h.consultas.length = 0;
    const r = await llamar("diagnostico_marca", marca());
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual(existe);
    expect(h.consultas).toEqual([]);
    expect(h.notas).toEqual([]);
  });

  it("413 con un cuerpo de más de 16 KB", async () => {
    const r = await ejecutarLlamada(req(null, JSON.stringify(marca({ motivo: "x".repeat(17_000) }))), ORG, "diagnostico_marca");
    expect(r.status).toBe(413);
    expect((await r.json()).error.code).toBe("payload_too_large");
  });

  it("422 `invalid` con JSON roto o sin sobre", async () => {
    const roto = await ejecutarLlamada(req(null, "{no"), ORG, "diagnostico_eco");
    const sinSobre = await llamar("diagnostico_eco", { args: {} });
    expect([roto.status, sinSobre.status]).toEqual([422, 422]);
    expect((await sinSobre.json()).error.code).toBe("invalid");
  });

  it("404 `not_found` si la conversación no es de este negocio", async () => {
    h.conv = null;
    const r = await llamar("diagnostico_eco", { conversationId: "cv_B", dispatchId: "d", args: { texto: "hola" } });
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe("not_found");
  });

  it("409 `ai_paused` con la IA apagada o en handoff, sin ejecutar", async () => {
    h.conv = { aiEnabled: false, handoffAt: null };
    expect((await llamar("diagnostico_marca", marca())).status).toBe(409);
    h.conv = { aiEnabled: true, handoffAt: new Date() };
    const r = await llamar("diagnostico_marca", marca());
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("ai_paused");
    expect(h.notas).toEqual([]);
    expect(h.filas).toEqual([]);
  });

  it("422 `invalid_args` con la ruta del error", async () => {
    const r = await llamar("diagnostico_eco", { conversationId: "cv_1", dispatchId: "d", args: { texto: 5 } });
    expect(r.status).toBe(422);
    const b = await r.json();
    expect(b.error.code).toBe("invalid_args");
    expect(b.error.details).toEqual({ path: ["texto"] });
    const extra = await llamar("diagnostico_eco", { conversationId: "cv_1", dispatchId: "d", args: { texto: "a", otro: 1 } });
    expect(extra.status).toBe(422);
  });

  it("200 de lectura: ejecuta cada vez y no anota nada", async () => {
    const r = await llamar("diagnostico_eco", { conversationId: "cv_1", dispatchId: "d", args: { texto: "hola" } });
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b).toMatchObject({ ok: true, estado: "hecho", result: { eco: "hola" } });
    expect(h.filas).toEqual([]);
  });
});

describe("idempotencia de las de escritura", () => {
  it("la repetición devuelve la respuesta guardada sin volver a ejecutar", async () => {
    const a = await (await llamar("diagnostico_marca", marca())).json();
    const b = await (await llamar("diagnostico_marca", marca())).json();
    expect(a).toMatchObject({ ok: true, estado: "hecho" });
    expect(b).toEqual(a);
    expect(h.notas).toHaveLength(1);
    expect(h.notas[0]).toMatchObject({ organizationId: ORG, conversationId: "cv_1", texto: "[Diagnóstico] prueba", authorUserId: null });
    expect(h.filas).toHaveLength(1);
    expect(h.filas[0]).toMatchObject({ estado: "hecha", dispatchId: "dsp_1", tool: "diagnostico_marca" });
    expect(h.publish).toHaveBeenCalledTimes(1);
  });

  it("otro despacho u otros argumentos sí ejecutan", async () => {
    await llamar("diagnostico_marca", marca());
    await llamar("diagnostico_marca", marca(undefined, "dsp_2"));
    await llamar("diagnostico_marca", marca({ motivo: "otra" }));
    expect(h.notas).toHaveLength(3);
  });

  it("si la primera sigue en curso: `{ok:true, estado:'en_curso', result:{}}` sin ejecutar", async () => {
    let soltar: () => void = () => {};
    let ejecuciones = 0;
    h.extra.diagnostico = [
      herramienta("diagnostico_larga", () => {
        ejecuciones++;
        return new Promise((ok) => (soltar = () => ok({ ok: true, result: { listo: true } })));
      }),
    ];
    const primera = llamar("diagnostico_larga", marca({}));
    await vi.waitFor(() => expect(ejecuciones).toBe(1));
    const segunda = await (await llamar("diagnostico_larga", marca({}))).json();
    expect(segunda).toEqual({ ok: true, estado: "en_curso", result: {} });
    soltar();
    expect(await (await primera).json()).toEqual({ ok: true, estado: "hecho", result: { listo: true } });
    expect(ejecuciones).toBe(1);
  });

  it("una «en curso» abandonada (más de 60 s) se vuelve a tomar", async () => {
    await llamar("diagnostico_marca", marca());
    h.filas[0]!.estado = "en_curso";
    h.filas[0]!.updatedAt = new Date(Date.now() - 120_000);
    await llamar("diagnostico_marca", marca());
    expect(h.notas).toHaveLength(2);
  });

  it("504 `tool_timeout`: aborta la señal, queda `fallida` y la repetición vuelve a ejecutar", async () => {
    let senal: AbortSignal | null = null;
    let ejecuciones = 0;
    h.extra.diagnostico = [
      herramienta("diagnostico_lenta", (ctx) => {
        ejecuciones++;
        senal = ctx.signal;
        return ejecuciones === 1 ? new Promise(() => {}) : Promise.resolve({ ok: true, result: { segunda: true } });
      }),
    ];
    const r = await llamar("diagnostico_lenta", marca({}), { timeoutMs: 20 });
    expect(r.status).toBe(504);
    expect((await r.json()).error.code).toBe("tool_timeout");
    expect(senal!.aborted).toBe(true);
    expect(h.filas[0]!.estado).toBe("fallida");
    const otra = await (await llamar("diagnostico_lenta", marca({}))).json();
    expect(otra).toEqual({ ok: true, estado: "hecho", result: { segunda: true } });
    expect(ejecuciones).toBe(2);
  });

  it("500 si el manejador revienta (con sobre) y queda `fallida`", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    h.extra.diagnostico = [herramienta("diagnostico_rota", async () => Promise.reject(new Error("boom")))];
    const r = await llamar("diagnostico_rota", marca({}));
    expect(r.status).toBe(500);
    expect((await r.json()).error.code).toBe("internal");
    expect(h.filas[0]!.estado).toBe("fallida");
    err.mockRestore();
  });
});

describe("el resultado", () => {
  it("más de 4 KB no se devuelve: `resultado_grande`", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.extra.diagnostico = [herramienta("diagnostico_enorme", async () => ({ ok: true, result: { x: "y".repeat(5000) } }), "lectura")];
    const r = await llamar("diagnostico_enorme", marca({}));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: false, error: "resultado_grande" });
    warn.mockRestore();
  });

  it("un error funcional viaja como 200 `{ok:false}` y respeta `en_curso`", () => {
    expect(cuerpoDe({ ok: false, error: "sin_stock", detalle: "no hay" }, "x")).toEqual({ ok: false, error: "sin_stock", detalle: "no hay" });
    expect(cuerpoDe({ ok: true, result: {}, estado: "en_curso" }, "x")).toEqual({ ok: true, result: {}, estado: "en_curso" });
  });
});

describe("A ↛ B", () => {
  it("los módulos y la conversación se buscan SIEMPRE en la organización de la credencial", async () => {
    h.conv = null;
    await ejecutarLlamada(req({ conversationId: "cv_B", dispatchId: "d", args: { texto: "x" } }), ORG, "diagnostico_eco");
    expect(h.modulosPedidos).toEqual([ORG]);
    const conv = h.consultas.filter((c) => c.tabla === "conversation");
    expect(conv).toHaveLength(1);
    expect(conv[0]!.params).toContain(ORG);
    expect(conv[0]!.params).toContain("cv_B");
  });

  it("la misma clave en otra organización no devuelve la respuesta guardada de A", async () => {
    await llamar("diagnostico_marca", marca());
    await ejecutarLlamada(req(marca()), "org_B", "diagnostico_marca");
    expect(h.notas.map((n) => n.organizationId)).toEqual([ORG, "org_B"]);
  });
});

describe("retención", () => {
  it("borra las llamadas de más de 30 días", async () => {
    const ahora = new Date("2026-11-19T00:00:00Z");
    expect(await purgarLlamadasViejas(ahora)).toBe(1);
    const corte = h.fecha(h.borrados[0]!)!;
    expect(ahora.getTime() - corte.getTime()).toBe(RETENCION_LLAMADAS_MS);
  });
});
