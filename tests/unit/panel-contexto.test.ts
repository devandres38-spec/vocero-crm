import type { Sql } from "postgres";
import { beforeEach, describe, expect, it } from "vitest";
import { clienteConRls, FIJAR_PANEL } from "@/lib/db/cliente-rls";
import {
  comoPanel,
  comoSistema,
  conNegocio,
  contextoActual,
  PanelSinSalida,
  trabajoDeFondo,
} from "@/lib/db/contexto";
import { motivosParaNoArrancar } from "@/lib/db/rls-arranque";
import { FueraDelPanel, negociosDelPanel, saludDelPanel } from "@/server/panel/datos";

/**
 * 076 (D16 de Aliantis) — El panel de Andres corre con el rol `vocero_panel`,
 * que no puede leer ninguna tabla. Cada consulta, dentro de su transacción:
 * `set_config('role', 'vocero_panel', true)` y el superadmin que llama. Y
 * desde el panel no se entra a un negocio ni al modo sistema.
 */
function sqlFalso(log: string[]) {
  function sentencia(donde: string, q: string, p?: unknown[]) {
    const s = {
      values() {
        return s;
      },
      execute() {
        log.push(`${donde}:${q}${p ? ` ${JSON.stringify(p)}` : ""}`);
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
  return {
    unsafe: (q: string, p?: unknown[]) => sentencia("directa", q, p),
    begin: async (...args: unknown[]) => {
      const fn = args[args.length - 1] as (t: unknown) => Promise<unknown>;
      log.push("begin");
      const r = await fn(tx);
      log.push("commit");
      return r;
    },
  } as unknown as Sql;
}

let log: string[];
let db: Sql;
beforeEach(() => {
  log = [];
  db = clienteConRls(sqlFalso(log), { modo: "lanzar" });
});

describe("076 — cada consulta del panel corre con el rol vocero_panel", () => {
  it("una consulta suelta: begin, el rol y el superadmin (locales), la consulta, commit", async () => {
    await comoPanel("usr_andres", async () => {
      await db.unsafe("select * from vocero_panel_negocios()", []);
    });
    expect(log).toEqual([
      "begin",
      `tx:${FIJAR_PANEL} ["usr_andres"]`,
      "tx:select * from vocero_panel_negocios() []",
      "commit",
    ]);
    expect(FIJAR_PANEL).toBe(
      "select set_config('app.superadmin_id', $1, true), set_config('role', 'vocero_panel', true)"
    );
  });

  it("una transacción (begin) también empieza con el rol del panel", async () => {
    await comoPanel("usr_andres", () =>
      (db.begin as unknown as (fn: (tx: Sql) => Promise<unknown>) => Promise<unknown>)(async (tx) =>
        tx.unsafe("select 1")
      )
    );
    expect(log.slice(0, 2)).toEqual(["begin", `tx:${FIJAR_PANEL} ["usr_andres"]`]);
  });

  it("una consulta perezosa (como las de Drizzle) corre DENTRO del panel", async () => {
    const perezosa = { then: (ok: (v: unknown) => unknown) => db.unsafe("select 1", []).then(ok) };
    await comoPanel("usr_andres", () => perezosa as unknown as PromiseLike<unknown>);
    expect(log[1]).toBe(`tx:${FIJAR_PANEL} ["usr_andres"]`);
  });

  it("el contexto dice quién es el superadmin", async () => {
    await comoPanel("usr_andres", async () => {
      expect(contextoActual()).toEqual({ tipo: "panel", superadminId: "usr_andres" });
    });
  });
});

describe("076 — desde el panel no se sale (PanelSinSalida)", () => {
  it("a un negocio", async () => {
    await expect(
      comoPanel("usr_andres", () => conNegocio("org_a", async () => 1))
    ).rejects.toBeInstanceOf(PanelSinSalida);
  });

  it("al modo sistema (que ve las tablas sin RLS, como user o account)", async () => {
    await expect(
      comoPanel("usr_andres", () => comoSistema("x", async () => 1))
    ).rejects.toBeInstanceOf(PanelSinSalida);
  });

  it("a un trabajo de fondo", async () => {
    await expect(
      comoPanel("usr_andres", () => trabajoDeFondo("x", async () => 1))
    ).rejects.toBeInstanceOf(PanelSinSalida);
  });

  it("y al panel no se entra desde un negocio ni desde el sistema", async () => {
    await expect(
      conNegocio("org_a", () => comoPanel("usr_andres", async () => 1))
    ).rejects.toBeInstanceOf(PanelSinSalida);
    await expect(
      comoSistema("x", () => comoPanel("usr_andres", async () => 1))
    ).rejects.toBeInstanceOf(PanelSinSalida);
  });

  it("ni con otro superadmin anidado", async () => {
    await expect(
      comoPanel("usr_andres", () => comoPanel("usr_otro", async () => 1))
    ).rejects.toBeInstanceOf(PanelSinSalida);
  });

  it("un id raro se rechaza antes de tocar la base", () => {
    expect(() => comoPanel("x'; drop table user; --", async () => 1)).toThrow();
    expect(log).toEqual([]);
  });
});

describe("076 — el arranque exige que la app no herede el panel", () => {
  it("si hereda los permisos de vocero_panel, es un motivo para no arrancar", async () => {
    const fila = { rolsuper: false, rolbypassrls: false, dueno: false, hereda_panel: true, sin_rls: [] };
    const sql = (async () => [fila]) as unknown as Sql;
    expect(await motivosParaNoArrancar(sql)).toEqual(["hereda los permisos de vocero_panel"]);
  });
});

describe("076 — los datos del panel solo corren dentro de comoPanel", () => {
  it("fuera de él (o desde un negocio), FueraDelPanel antes de tocar la base", async () => {
    await expect(negociosDelPanel()).rejects.toBeInstanceOf(FueraDelPanel);
    await expect(conNegocio("org_a", () => saludDelPanel())).rejects.toBeInstanceOf(FueraDelPanel);
  });
});
