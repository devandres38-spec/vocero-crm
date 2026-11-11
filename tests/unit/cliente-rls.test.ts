import { readFileSync } from "node:fs";
import path from "node:path";
import type { Sql } from "postgres";
import { beforeEach, describe, expect, it } from "vitest";
import { clienteConRls, FIJAR_NEGOCIO } from "@/lib/db/cliente-rls";
import {
  comoSistema,
  conNegocio,
  ConsultaSinNegocio,
  NegocioCruzado,
  negocioActual,
  trabajoDeFondo,
} from "@/lib/db/contexto";

/**
 * 075 (D3) — El negocio se fija DEBAJO de Drizzle: cada consulta, dentro de su
 * transacción, con `set_config(…, true)`. La base es simulada, pero registra
 * el orden real: begin, set_config, la consulta, commit.
 */
type Registro = string[];

function sqlFalso(log: Registro) {
  function sentencia(donde: string, q: string, p?: unknown[]) {
    let valores = false;
    const s = {
      values() {
        valores = true;
        return s;
      },
      execute() {
        log.push(`${donde}:${q}${p ? ` ${JSON.stringify(p)}` : ""}${valores ? " (values)" : ""}`);
        return s;
      },
      then(ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) {
        if (!log.some((l) => l.startsWith(`${donde}:${q}`))) s.execute();
        return Promise.resolve([{ q }]).then(ok, ko);
      },
    };
    return s;
  }
  const tx = { unsafe: (q: string, p?: unknown[]) => sentencia("tx", q, p) };
  const sql = {
    options: { parsers: {}, serializers: {} },
    unsafe: (q: string, p?: unknown[]) => sentencia("directa", q, p),
    begin: async (...args: unknown[]) => {
      const fn = args[args.length - 1] as (t: unknown) => Promise<unknown>;
      log.push("begin");
      const r = await fn(tx);
      log.push("commit");
      return r;
    },
  };
  return sql as unknown as Sql;
}

let log: Registro;
let lanzar: Sql;
let avisar: Sql;
const avisos: string[] = [];

beforeEach(() => {
  log = [];
  avisos.length = 0;
  lanzar = clienteConRls(sqlFalso(log), { modo: "lanzar" });
  avisar = clienteConRls(sqlFalso(log), { modo: "avisar", avisar: (d) => avisos.push(d) });
});

describe("075 — el negocio en cada transacción", () => {
  it("una consulta suelta en conNegocio: begin, set_config LOCAL con el negocio, la consulta, commit", async () => {
    await conNegocio("org_a", async () => {
      await lanzar.unsafe("select 1 from contact", []);
    });
    expect(log).toEqual([
      "begin",
      `tx:${FIJAR_NEGOCIO} ["org_a"]`,
      "tx:select 1 from contact []",
      "commit",
    ]);
    expect(FIJAR_NEGOCIO).toBe("select set_config('app.organization_id', $1, true)");
  });

  it("con .values() (como la usa Drizzle) también", async () => {
    await conNegocio("org_a", async () => {
      await (lanzar.unsafe("select 1", []) as unknown as { values(): Promise<unknown> }).values();
    });
    expect(log).toEqual(["begin", `tx:${FIJAR_NEGOCIO} ["org_a"]`, "tx:select 1 [] (values)", "commit"]);
  });

  it("db.transaction (begin) fija el negocio antes que nada", async () => {
    await conNegocio("org_b", async () => {
      await lanzar.begin(async (tx) => {
        await (tx as unknown as { unsafe: (q: string) => PromiseLike<unknown> }).unsafe("update x");
      });
    });
    expect(log[0]).toBe("begin");
    expect(log[1]).toBe(`tx:${FIJAR_NEGOCIO} ["org_b"]`);
    expect(log[2]).toContain("tx:update x");
  });

  it("dos negocios a la vez: cada consulta lleva el suyo", async () => {
    await Promise.all([
      conNegocio("org_a", () => Promise.resolve(lanzar.unsafe("select a", []))),
      conNegocio("org_b", () => Promise.resolve(lanzar.unsafe("select b", []))),
    ]);
    const fijados = log.filter((l) => l.startsWith(`tx:${FIJAR_NEGOCIO}`));
    expect(fijados.sort()).toEqual([`tx:${FIJAR_NEGOCIO} ["org_a"]`, `tx:${FIJAR_NEGOCIO} ["org_b"]`]);
  });

  it("modo sistema: la consulta va tal cual, sin negocio", async () => {
    await trabajoDeFondo("prueba", async () => {
      await lanzar.unsafe("select vocero_organizaciones()", []);
    });
    expect(log).toEqual(["directa:select vocero_organizaciones() []"]);
  });
});

describe("075 — consultas perezosas (como las de Drizzle)", () => {
  it("una consulta que se ejecuta al esperarla corre DENTRO del negocio", async () => {
    let visto: string | null = "sin ejecutar";
    const perezosa = {
      then(ok: (v: string | null) => unknown) {
        visto = negocioActual();
        return Promise.resolve(visto).then(ok);
      },
    };
    await conNegocio("org_a", () => perezosa);
    expect(visto).toBe("org_a");
    await trabajoDeFondo("x", () => conNegocio("org_b", () => perezosa));
    expect(visto).toBe("org_b");
  });
});

describe("075 — sin contexto", () => {
  it("modo lanzar: ConsultaSinNegocio y nada llega a la base", async () => {
    await expect(Promise.resolve(lanzar.unsafe("select * from message", []))).rejects.toBeInstanceOf(
      ConsultaSinNegocio
    );
    await expect(lanzar.begin(async () => 1)).rejects.toBeInstanceOf(ConsultaSinNegocio);
    expect(log).toEqual([]);
  });

  it("modo avisar (solo T3 a T7): registra y deja pasar", async () => {
    await avisar.unsafe("select * from message", []);
    expect(avisos).toEqual(["select * from message"]);
    expect(log).toEqual(["directa:select * from message []"]);
  });
});

describe("075 — no se cruza de un negocio a otro", () => {
  it("conNegocio(B) dentro de conNegocio(A): error", async () => {
    await expect(conNegocio("org_a", () => conNegocio("org_b", async () => 1))).rejects.toBeInstanceOf(
      NegocioCruzado
    );
  });

  it("el mismo negocio anidado: permitido", async () => {
    await expect(conNegocio("org_a", () => conNegocio("org_a", async () => 1))).resolves.toBe(1);
  });

  it("comoSistema dentro de A no abre la puerta a B", async () => {
    await expect(
      conNegocio("org_a", () => comoSistema("x", () => conNegocio("org_b", async () => 1)))
    ).rejects.toBeInstanceOf(NegocioCruzado);
  });

  it("trabajoDeFondo empieza de cero (un temporizador creado en A puede procesar B)", async () => {
    await expect(
      conNegocio("org_a", () => trabajoDeFondo("worker", () => conNegocio("org_b", async () => negocioActual())))
    ).resolves.toBe("org_b");
  });

  it("un id de negocio raro se rechaza", () => {
    expect(() => conNegocio("org_a'; drop table x;--", async () => 1)).toThrow("organizationId inválido");
  });
});

describe("075 — getDb y dbDeCuentas", () => {
  it("getDb usa el envoltorio; dbDeCuentas, el cliente sin envoltorio", () => {
    const fuente = readFileSync(path.resolve(__dirname, "../../src/lib/db/index.ts"), "utf8");
    expect(fuente).toMatch(/drizzle\(clienteConRls\(getSql\(\)\), \{ schema \}\)/);
    expect(fuente).toMatch(/cachedCuentas = drizzle\(getSql\(\), \{ schema \}\)/);
  });
});
