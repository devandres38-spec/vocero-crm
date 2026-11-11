import { hashPassword, verifyPassword } from "better-auth/crypto";
import { describe, expect, it } from "vitest";
import { schema } from "@/lib/db";
import { negocioActual } from "@/lib/db/contexto";
import {
  AltaError,
  CANDADO_ALTA,
  contrasenaFuerte,
  crearNegocio,
  ETAPAS_INICIALES,
  slugDe,
  slugLibre,
} from "@/server/auth/alta";
import { baseGrabadora } from "./fixtures/base-grabadora";

/**
 * 074 — El alta de un negocio, solo por Andres: todo en una transacción, un
 * correo pertenece a un solo negocio, slug único.
 */
const DATOS = { nombre: "Clínica Sonrisa", correo: " Duena@Sonrisa.CO ", duenoNombre: "Ana" };
const rapido = { contrasena: () => "contrasena-de-prueba-24c", hash: async (p: string) => `h(${p})` };

/** Una base cuya transacción entrega OTRO objeto: así se ve qué se escribió fuera de ella. */
function bases() {
  const fuera = baseGrabadora();
  const dentro = baseGrabadora();
  const db = { ...fuera.db, transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(dentro.db) };
  return { db: db as never, fuera, dentro };
}

describe("074 — crearNegocio", () => {
  it("crea negocio, dueño, cuenta, membresía owner, etapas y perfil, todo dentro de la transacción", async () => {
    const { db, fuera, dentro } = bases();
    const n = await crearNegocio(db, DATOS, rapido);

    expect(fuera.ops.filter((o) => o.op !== "select")).toEqual([]);
    const inserciones = dentro.ops.filter((o) => o.op === "insert");
    expect(inserciones.map((o) => o.tabla)).toEqual([
      schema.organization,
      schema.user,
      schema.account,
      schema.member,
      schema.pipelineStage,
      schema.agentProfile,
    ]);
    const valores = (t: unknown) => inserciones.find((o) => o.tabla === t)!.valores as Record<string, unknown>;
    expect(valores(schema.organization)).toMatchObject({ id: n.organizationId, name: "Clínica Sonrisa", slug: "clinica-sonrisa" });
    expect(valores(schema.user)).toMatchObject({ id: n.userId, email: "duena@sonrisa.co", name: "Ana" });
    // 076 — La contraseña la generó el alta: el dueño pone la suya al entrar.
    expect(valores(schema.user)).toMatchObject({ debeCambiarContrasena: true });
    expect(valores(schema.account)).toMatchObject({
      accountId: n.userId,
      userId: n.userId,
      providerId: "credential",
      password: "h(contrasena-de-prueba-24c)",
    });
    expect(valores(schema.member)).toMatchObject({ organizationId: n.organizationId, userId: n.userId, role: "owner" });
    expect((valores(schema.pipelineStage) as unknown as unknown[]).length).toBe(ETAPAS_INICIALES.length);
    expect(valores(schema.agentProfile)).toMatchObject({ organizationId: n.organizationId });
    expect(n.contrasena).toBe("contrasena-de-prueba-24c");
  });

  it("075 — la transacción corre dentro del negocio NUEVO (así el WITH CHECK deja insertarlo)", async () => {
    const fuera = baseGrabadora();
    const dentro = baseGrabadora();
    let negocio: string | null = null;
    const db = {
      ...fuera.db,
      transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => {
        negocio = negocioActual();
        return fn(dentro.db);
      },
    };
    const n = await crearNegocio(db as never, DATOS, rapido);
    expect(negocio).toBe(n.organizationId);
  });

  it("toma el candado de las altas antes de mirar el correo", async () => {
    const { db, dentro } = bases();
    await crearNegocio(db, DATOS, rapido);
    expect(dentro.ops[0]).toMatchObject({ op: "execute" });
    expect(dentro.ops[0]!.where!.params).toEqual([CANDADO_ALTA]);
  });

  it("un correo que ya existe (dueño o cuenta de equipo de otro negocio): rechazo y nada escrito", async () => {
    const { db, fuera, dentro } = bases();
    dentro.responder(schema.user, [{ id: "usr_otro" }]);
    await expect(crearNegocio(db, DATOS, rapido)).rejects.toMatchObject({
      name: "AltaError",
      codigo: "correo_existente",
    });
    expect([...fuera.ops, ...dentro.ops].filter((o) => o.op === "insert")).toEqual([]);
  });

  it("si falla una inserción, el error sale de la transacción (que la deshace entera)", async () => {
    const { db, dentro } = bases();
    const insertar = dentro.db.insert;
    dentro.db.insert = ((tabla: unknown) => {
      if (tabla === schema.pipelineStage) throw new Error("falla a mitad");
      return insertar(tabla);
    }) as typeof insertar;
    await expect(crearNegocio(db, DATOS, rapido)).rejects.toThrow("falla a mitad");
  });

  it("datos inválidos: AltaError sin tocar la base", async () => {
    const { db, fuera, dentro } = bases();
    await expect(crearNegocio(db, { ...DATOS, correo: "no-es-correo" }, rapido)).rejects.toBeInstanceOf(AltaError);
    expect([...fuera.ops, ...dentro.ops]).toEqual([]);
  });

  it("slug ocupado: el siguiente libre", async () => {
    const { db, dentro } = bases();
    // 075 — Los ocupados salen de vocero_slugs_ocupados (los demás negocios no se ven).
    const ejecutar = dentro.db.execute;
    dentro.db.execute = (async (q: Parameters<typeof ejecutar>[0]) => {
      const r = await ejecutar(q);
      const ultimo = dentro.ops[dentro.ops.length - 1]!;
      return /vocero_slugs_ocupados/.test(ultimo.where!.sql)
        ? [{ slugs: ["clinica-sonrisa", "clinica-sonrisa-2"] }]
        : r;
    }) as typeof ejecutar;
    const n = await crearNegocio(db, DATOS, rapido);
    expect(n.slug).toBe("clinica-sonrisa-3");
  });
});

describe("074 — piezas del alta", () => {
  it("slugDe: sin tildes ni signos, con respaldo", () => {
    expect(slugDe("Clínica Sonrisa & Cía.")).toBe("clinica-sonrisa-cia");
    expect(slugDe("  Ñandú  ")).toBe("nandu");
    expect(slugDe("¡¡!!")).toBe("negocio");
    expect(slugDe("a".repeat(60)).length).toBe(40);
  });

  it("slugLibre", () => {
    expect(slugLibre("x", [])).toBe("x");
    expect(slugLibre("x", ["x", "x-2"])).toBe("x-3");
  });

  it("contrasenaFuerte: 24 caracteres base64url, distinta cada vez", () => {
    const a = contrasenaFuerte();
    expect(a).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(contrasenaFuerte()).not.toBe(a);
  });

  it("el hash real verifica con la función del login", async () => {
    const p = contrasenaFuerte();
    expect(await verifyPassword({ hash: await hashPassword(p), password: p })).toBe(true);
  });
});
