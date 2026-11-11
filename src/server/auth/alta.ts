import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * 074 (pilar 1 de Aliantis) — El alta de un negocio: solo la hace Andres, con
 * `pnpm negocio:alta` y, en el bloque I, desde su panel (las dos llaman esto).
 *
 * Todo en UNA transacción: negocio, dueño (usuario + cuenta con contraseña),
 * membresía `owner`, las etapas del pipeline y el perfil del agente. Si algo
 * falla, no queda nada a medias (ni un usuario huérfano que bloquee el correo).
 *
 * Un correo pertenece a un solo negocio (respuesta 4 de Andres): si ya existe,
 * como dueño o como cuenta de equipo de cualquiera, el alta se rechaza.
 *
 * El dueño se escribe directo en `user` y `account` (proveedor `credential`)
 * con `hashPassword` de `better-auth/crypto`, la misma función con la que el
 * login verifica: así cabe en la transacción, cosa que `signUpEmail` no hace.
 */

type Db = ReturnType<typeof getDb>;

/** Etapas sembradas del pipeline (US2), las mismas de siempre. */
export const ETAPAS_INICIALES: { name: string; kind: "open" | "won" | "lost" }[] = [
  { name: "Nuevo", kind: "open" },
  { name: "En conversación", kind: "open" },
  { name: "Interesado", kind: "open" },
  { name: "Cliente", kind: "won" },
  { name: "Perdido", kind: "lost" },
];

/** Candado de las altas: dos a la vez no eligen el mismo slug ni el mismo correo. */
export const CANDADO_ALTA = 874202;

export const datosAlta = z.object({
  nombre: z.string().trim().min(2).max(120),
  correo: z.string().trim().toLowerCase().email().max(254),
  duenoNombre: z.string().trim().min(1).max(120),
});
export type DatosAlta = z.input<typeof datosAlta>;

export class AltaError extends Error {
  constructor(
    readonly codigo: "datos_invalidos" | "correo_existente",
    message: string
  ) {
    super(message);
    this.name = "AltaError";
  }
}

/** 24 caracteres base64url (144 bits): se muestra una sola vez y nunca se guarda en claro. */
export function contrasenaFuerte(): string {
  return randomBytes(18).toString("base64url");
}

/** «Clínica Sonrisa & Cía.» → `clinica-sonrisa-cia`. */
export function slugDe(nombre: string): string {
  const base = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base || "negocio";
}

/** El primer slug libre: `base`, `base-2`, `base-3`… */
export function slugLibre(base: string, usados: readonly string[]): string {
  const ocupados = new Set(usados);
  if (!ocupados.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidato = `${base}-${n}`;
    if (!ocupados.has(candidato)) return candidato;
  }
}

export type NegocioCreado = {
  organizationId: string;
  userId: string;
  slug: string;
  nombre: string;
  correo: string;
  /** Solo para mostrarla UNA vez a quien hizo el alta. */
  contrasena: string;
};

export async function crearNegocio(
  db: Db,
  entrada: DatosAlta,
  deps: { contrasena?: () => string; hash?: (p: string) => Promise<string> } = {}
): Promise<NegocioCreado> {
  const leido = datosAlta.safeParse(entrada);
  if (!leido.success) {
    const detalle = leido.error.issues
      .map((i) => `${i.path.join(".") || "datos"}: ${i.message}`)
      .join("; ");
    throw new AltaError("datos_invalidos", detalle);
  }
  const { nombre, correo, duenoNombre } = leido.data;
  const contrasena = (deps.contrasena ?? contrasenaFuerte)();
  // El hash (lento a propósito) va antes de abrir la transacción.
  const hash = await (deps.hash ?? hashPassword)(contrasena);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${CANDADO_ALTA})`);

    const [existente] = await tx
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, correo))
      .limit(1);
    if (existente) {
      throw new AltaError(
        "correo_existente",
        `Ya existe una cuenta con ${correo}: un correo pertenece a un solo negocio`
      );
    }

    const base = slugDe(nombre);
    const usados = await tx
      .select({ slug: schema.organization.slug })
      .from(schema.organization)
      .where(
        or(eq(schema.organization.slug, base), like(schema.organization.slug, `${base}-%`))
      );
    const slug = slugLibre(
      base,
      usados.map((u) => u.slug).filter((s): s is string => Boolean(s))
    );

    const organizationId = newId("organization");
    const userId = newId("user");
    await tx.insert(schema.organization).values({ id: organizationId, name: nombre, slug });
    await tx.insert(schema.user).values({
      id: userId,
      name: duenoNombre,
      email: correo,
      emailVerified: false,
    });
    await tx.insert(schema.account).values({
      id: newId("account"),
      accountId: userId,
      providerId: "credential",
      userId,
      password: hash,
    });
    await tx.insert(schema.member).values({
      id: newId("member"),
      organizationId,
      userId,
      role: "owner",
    });
    await tx.insert(schema.pipelineStage).values(
      ETAPAS_INICIALES.map((s, i) => ({
        id: newId("stage"),
        organizationId,
        name: s.name,
        position: i,
        kind: s.kind,
      }))
    );
    await tx.insert(schema.agentProfile).values({
      id: newId("agentProfile"),
      organizationId,
    });

    return { organizationId, userId, slug, nombre, correo, contrasena };
  });
}
