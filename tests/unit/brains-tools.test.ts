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
  despacho: null as null | { organizationId?: string; conversationId: string; status: string; createdAt: Date; brainDeploymentId: string | null },
  despachoParams: [] as unknown[][],
  antesDeTomar: null as null | (() => void),
  ejecuciones: [] as string[],
  cuentas: [] as number[],
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
      if (tabla === "dispatch") {
        h.despachoParams.push(ps);
        return h.despacho && ps.includes(h.despacho.organizationId ?? "org_A") ? [h.despacho] : [];
      }
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
            const nueva = v as unknown as Fila;
            h.filas.push({ ...nueva, createdAt: nueva.createdAt ?? ahora, updatedAt: nueva.updatedAt ?? ahora, response: null });
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
          // El cierre con fencing (A-3): `en_curso` y la marca exacta de la toma.
          const cierre = !condicional && ps.includes("en_curso");
          const corte = fecha(ps);
          if (condicional) h.antesDeTomar?.();
          const puede =
            fila &&
            (cierre
              ? fila.estado === "en_curso" && corte !== undefined && fila.updatedAt.getTime() === corte.getTime()
              : !condicional || fila.estado === "fallida" || (fila.estado === "en_curso" && corte && fila.updatedAt < corte));
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

  const execute = (c: SQL) => {
    h.borrados.push(params(c));
    return Promise.resolve(Object.assign([], { count: h.cuentas.shift() ?? 0 }));
  };

  const db = { select, insert, update, delete: del, execute };
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
import { LOTE_PURGA, MAX_LOTES, purgarLlamadasViejas, RETENCION_LLAMADAS_MS } from "@/server/brains/llamadas-retencion";
import { defineHerramienta, type ModuleTool } from "@/modulos/tipos";

const ORG = "org_A";
const AMBITO = { organizationId: ORG, deploymentId: "brn_1" };

function req(cuerpo: unknown, crudo?: string): Request {
  return new Request("http://plataforma.test/api/brains/tools/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: crudo ?? JSON.stringify(cuerpo),
  });
}

const llamar = (nombre: string, cuerpo: unknown, opciones?: Parameters<typeof ejecutarLlamada>[3]) =>
  ejecutarLlamada(req(cuerpo), AMBITO, nombre, opciones);

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
  h.despacho = { organizationId: ORG, conversationId: "cv_1", status: "en_vuelo", createdAt: new Date(), brainDeploymentId: "brn_1" } as never;
  h.despachoParams.length = 0;
  h.antesDeTomar = null;
  h.ejecuciones.length = 0;
  h.cuentas.length = 0;
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
    const k = claveIdempotencia("cv_1", "dsp_1", "diagnostico_marca", { a: 1, b: 2 });
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(claveIdempotencia("cv_1", "dsp_1", "diagnostico_marca", { b: 2, a: 1 })).toBe(k);
    expect(claveIdempotencia("cv_1", "dsp_2", "diagnostico_marca", { a: 1, b: 2 })).not.toBe(k);
    expect(claveIdempotencia("cv_1", "dsp_1", "diagnostico_eco", { a: 1, b: 2 })).not.toBe(k);
    expect(claveIdempotencia("cv_1", "dsp_1", "diagnostico_marca", { a: 1, b: 3 })).not.toBe(k);
    // A-1 (auditoría 072-B): la conversación también.
    expect(claveIdempotencia("cv_2", "dsp_1", "diagnostico_marca", { a: 1, b: 2 })).not.toBe(k);
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
    const r = await ejecutarLlamada(req(null, JSON.stringify(marca({ motivo: "x".repeat(17_000) }))), AMBITO, "diagnostico_marca");
    expect(r.status).toBe(413);
    expect((await r.json()).error.code).toBe("payload_too_large");
  });

  it("422 `invalid` con JSON roto o sin sobre", async () => {
    const roto = await ejecutarLlamada(req(null, "{no"), AMBITO, "diagnostico_eco");
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
    // B-4 (auditoría 072-B): con detalle para que el modelo no insista.
    expect(await r.json()).toEqual({
      ok: false,
      error: "resultado_grande",
      detalle: "el resultado no cabe en la respuesta; no repitas esta llamada con los mismos argumentos",
    });
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
    await ejecutarLlamada(req({ conversationId: "cv_B", dispatchId: "d", args: { texto: "x" } }), AMBITO, "diagnostico_eco");
    expect(h.modulosPedidos).toEqual([ORG]);
    const conv = h.consultas.filter((c) => c.tabla === "conversation");
    expect(conv).toHaveLength(1);
    expect(conv[0]!.params).toContain(ORG);
    expect(conv[0]!.params).toContain("cv_B");
  });

  it("la misma clave en otra organización no devuelve la respuesta guardada de A", async () => {
    await llamar("diagnostico_marca", marca());
    h.despacho = { ...h.despacho!, organizationId: "org_B" } as never;
    await ejecutarLlamada(req(marca()), { organizationId: "org_B", deploymentId: "brn_1" }, "diagnostico_marca");
    expect(h.notas.map((n) => n.organizationId)).toEqual([ORG, "org_B"]);
  });
});

describe("retención (M-2, auditoría 072-B: en lotes)", () => {
  it("borra las de más de 30 días en lotes de 1000 hasta que un lote sale corto", async () => {
    const ahora = new Date("2026-11-19T00:00:00Z");
    h.cuentas.push(LOTE_PURGA, LOTE_PURGA, 5);
    expect(await purgarLlamadasViejas(ahora)).toBe(2 * LOTE_PURGA + 5);
    expect(h.borrados).toHaveLength(3);
    const ps = h.borrados[0]!;
    const corte = ps.find((p) => p instanceof Date) as Date;
    expect(ahora.getTime() - corte.getTime()).toBe(RETENCION_LLAMADAS_MS);
    expect(ps).toContain(LOTE_PURGA);
  });

  it("como mucho MAX_LOTES por pasada (lo demás, en la siguiente)", async () => {
    h.cuentas.push(...Array.from({ length: 50 }, () => LOTE_PURGA));
    expect(await purgarLlamadasViejas()).toBe(MAX_LOTES * LOTE_PURGA);
    expect(h.borrados).toHaveLength(MAX_LOTES);
  });
});

describe("auditoría 072-B — el despacho (A-1)", () => {
  const caso = async () => llamar("diagnostico_marca", marca());
  const errorDe = async (r: Response) => [r.status, (await r.json()).error.code];

  it("sin despacho, de otra conversación, no entregado o de más de 24 h: 422 `despacho_desconocido` sin ejecutar", async () => {
    h.despacho = null;
    expect(await errorDe(await caso())).toEqual([422, "despacho_desconocido"]);
    h.despacho = { organizationId: ORG, conversationId: "cv_otra", status: "en_vuelo", createdAt: new Date(), brainDeploymentId: "brn_1" } as never;
    expect(await errorDe(await caso())).toEqual([422, "despacho_desconocido"]);
    for (const status of ["pendiente", "caducado_a_humano", "descartado"]) {
      h.despacho = { organizationId: ORG, conversationId: "cv_1", status, createdAt: new Date(), brainDeploymentId: "brn_1" } as never;
      expect(await errorDe(await caso()), status).toEqual([422, "despacho_desconocido"]);
    }
    h.despacho = {
      organizationId: ORG,
      conversationId: "cv_1",
      status: "entregado",
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      brainDeploymentId: "brn_1",
    } as never;
    expect(await errorDe(await caso())).toEqual([422, "despacho_desconocido"]);
    expect(h.notas).toEqual([]);
    expect(h.filas).toEqual([]);
  });

  it("entregado a OTRO despliegue: 409 `cerebro_reasignado`", async () => {
    h.despacho = { organizationId: ORG, conversationId: "cv_1", status: "entregado", createdAt: new Date(), brainDeploymentId: "brn_viejo" } as never;
    expect(await errorDe(await caso())).toEqual([409, "cerebro_reasignado"]);
    expect(h.notas).toEqual([]);
  });

  it("el despacho se busca en la organización de la credencial", async () => {
    await caso();
    expect(h.despachoParams[0]).toContain(ORG);
    expect(h.despachoParams[0]).toContain("dsp_1");
  });

  it("también las de lectura exigen un despacho válido", async () => {
    h.despacho = null;
    const r = await llamar("diagnostico_eco", { conversationId: "cv_1", dispatchId: "dsp_x", args: { texto: "hola" } });
    expect(r.status).toBe(422);
  });

  it("el mismo dispatchId en otra conversación NO devuelve la respuesta de la primera", async () => {
    await llamar("diagnostico_marca", marca());
    h.despacho = { organizationId: ORG, conversationId: "cv_2", status: "en_vuelo", createdAt: new Date(), brainDeploymentId: "brn_1" } as never;
    const b = await (await llamar("diagnostico_marca", { conversationId: "cv_2", dispatchId: "dsp_1", args: { motivo: "prueba" } })).json();
    expect(b).toMatchObject({ ok: true, estado: "hecho" });
    expect(h.notas.map((n) => n.conversationId)).toEqual(["cv_1", "cv_2"]);
    expect(h.filas.map((f) => f.conversationId)).toEqual(["cv_1", "cv_2"]);
  });

  it("defensa: una fila de otra conversación con la misma clave no se devuelve", async () => {
    await llamar("diagnostico_marca", marca());
    h.filas[0]!.conversationId = "cv_ajena";
    const r = await llamar("diagnostico_marca", marca());
    expect(r.status).toBe(422);
    expect(h.notas).toHaveLength(1);
  });
});

describe("auditoría 072-B — concurrencia", () => {
  it("A-2: si la primera terminó entre la lectura y la toma, devuelve su respuesta (no `en_curso` vacío)", async () => {
    await llamar("diagnostico_marca", marca());
    const guardada = h.filas[0]!.response;
    // Estado visto por la segunda: «en curso» (todavía no vencida)…
    h.filas[0]!.estado = "en_curso";
    h.filas[0]!.response = null;
    // …y justo antes de su toma, la primera termina.
    h.antesDeTomar = () => {
      h.filas[0]!.estado = "hecha";
      h.filas[0]!.response = guardada;
    };
    const r = await (await llamar("diagnostico_marca", marca())).json();
    expect(r).toEqual(guardada);
    expect(h.notas).toHaveLength(1);
  });

  it("A-2: si de verdad sigue en curso, `en_curso`", async () => {
    await llamar("diagnostico_marca", marca());
    h.filas[0]!.estado = "en_curso";
    expect(await (await llamar("diagnostico_marca", marca())).json()).toEqual({ ok: true, estado: "en_curso", result: {} });
  });

  it("A-3: una ejecución colgada que otra ya retomó no pisa el resultado del reintento", async () => {
    let soltar: (r: { ok: true; result: Record<string, unknown> }) => void = () => {};
    h.extra.diagnostico = [
      herramienta("diagnostico_lenta2", () => {
        h.ejecuciones.push("x");
        return h.ejecuciones.length === 1
          ? new Promise((ok) => (soltar = ok))
          : Promise.resolve({ ok: true, result: { quien: "reintento" } });
      }),
    ];
    const primera = llamar("diagnostico_lenta2", marca({}), { timeoutMs: 600_000 });
    await vi.waitFor(() => expect(h.ejecuciones).toHaveLength(1));
    // Pasan más de 60 s: la fila «en curso» vence y un reintento la toma.
    h.filas[0]!.updatedAt = new Date(Date.now() - 120_000);
    const segunda = await (await llamar("diagnostico_lenta2", marca({}))).json();
    expect(segunda).toEqual({ ok: true, estado: "hecho", result: { quien: "reintento" } });
    // La colgada termina tarde: su cierre no encuentra SU toma y no escribe.
    soltar({ ok: true, result: { quien: "colgada" } });
    await primera;
    expect(h.filas[0]).toMatchObject({ estado: "hecha", response: { ok: true, estado: "hecho", result: { quien: "reintento" } } });
  });
});

describe("auditoría 072-B — bajos", () => {
  it("B-1: `created_at` y `updated_at` salen del mismo reloj que decide", async () => {
    const fijo = new Date("2026-11-19T15:00:00.000Z");
    await llamar("diagnostico_marca", marca(), { ahora: () => fijo });
    expect(h.filas[0]!.createdAt.getTime()).toBe(fijo.getTime());
    expect(h.filas[0]!.estado).toBe("hecha");
  });

  it("B-2: la clave usa los argumentos YA validados (normalizados por el esquema)", async () => {
    h.extra.diagnostico = [
      defineHerramienta({
        nombre: "diagnostico_norm",
        descripcion: "Prueba.",
        args: z.object({ texto: z.string().trim() }).strict(),
        efecto: "escritura",
        ejecutar: async (_c, a) => {
          h.ejecuciones.push(a.texto);
          return { ok: true, result: { texto: a.texto } };
        },
      }) as ModuleTool,
    ];
    await llamar("diagnostico_norm", marca({ texto: "hola" }));
    await llamar("diagnostico_norm", marca({ texto: "  hola  " }));
    expect(h.ejecuciones).toEqual(["hola"]);
  });
});
