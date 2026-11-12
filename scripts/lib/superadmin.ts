import { z } from "zod";

/**
 * 076 (D16 de Aliantis, respuesta 8 de Andres) — Dar el superadministrador o
 * reiniciar su segundo factor. Solo con la conexión del DUEÑO de las tablas
 * (`DATABASE_MIGRATIONS_URL`): la app solo puede leer `superadministrador`,
 * así que ni un error de la app ni alguien con su usuario puede darlo.
 *
 * El superadmin no es miembro de ningún negocio (lo garantiza también un
 * trigger en `member`). Su segundo factor lo activa él mismo en la web la
 * primera vez que entra (`/admin/segundo-factor`, con un QR).
 *
 * Aquí está la lógica, con la base inyectada para probarla sin Postgres; el
 * comando es `scripts/superadmin.ts`.
 */

/** Lo mínimo del cliente `postgres` que usa: consultas con plantilla y transacción. */
export type SqlDelDueno = {
  <T = Record<string, unknown>>(partes: TemplateStringsArray, ...valores: unknown[]): Promise<T[]>;
  begin<T>(fn: (tx: SqlDelDueno) => Promise<T>): Promise<T>;
};

export const datosSuperadmin = z.object({
  correo: z.string().trim().toLowerCase().email().max(254),
  nombre: z.string().trim().min(1).max(120),
});

export class SuperadminError extends Error {
  constructor(
    readonly codigo: "datos_invalidos" | "correo_existente" | "no_es_superadmin" | "sin_url_del_dueno",
    message: string
  ) {
    super(message);
    this.name = "SuperadminError";
  }
}

/** La URL del dueño: sin ella no se hace nada (nunca con la de la app). */
export function urlDelDueno(env: Record<string, string | undefined>): string {
  const url = env.DATABASE_MIGRATIONS_URL;
  if (!url) {
    throw new SuperadminError(
      "sin_url_del_dueno",
      "Falta DATABASE_MIGRATIONS_URL (el dueño de las tablas): el superadmin no se da con el usuario de la app"
    );
  }
  return url;
}

export type SuperadminCreado = { userId: string; correo: string; contrasena: string };

export async function crearSuperadmin(
  sql: SqlDelDueno,
  entrada: { correo: string; nombre: string },
  deps: { id: () => string; idCuenta: () => string; contrasena: () => string; hash: (p: string) => Promise<string> }
): Promise<SuperadminCreado> {
  const leido = datosSuperadmin.safeParse(entrada);
  if (!leido.success) {
    throw new SuperadminError(
      "datos_invalidos",
      leido.error.issues.map((i) => `${i.path.join(".") || "datos"}: ${i.message}`).join("; ")
    );
  }
  const { correo, nombre } = leido.data;
  const contrasena = deps.contrasena();
  const hash = await deps.hash(contrasena);
  const userId = deps.id();
  await sql.begin(async (tx) => {
    const existe = await tx<{ id: string }>`select id from "user" where email = ${correo} limit 1`;
    if (existe.length > 0) {
      throw new SuperadminError(
        "correo_existente",
        `Ya existe una cuenta con ${correo}: un correo es de una sola cuenta, y el superadmin no puede ser de un negocio`
      );
    }
    await tx`insert into "user" (id, name, email, email_verified) values (${userId}, ${nombre}, ${correo}, false)`;
    await tx`insert into account (id, account_id, provider_id, user_id, password)
             values (${deps.idCuenta()}, ${userId}, 'credential', ${userId}, ${hash})`;
    await tx`insert into superadministrador (user_id) values (${userId})`;
  });
  return { userId, correo, contrasena };
}

/**
 * Cuando Andres pierde el teléfono Y los códigos de respaldo: borra su TOTP y
 * cierra sus sesiones. La próxima vez que entre, vuelve a activarlo con el QR.
 */
export async function reiniciarSegundoFactor(sql: SqlDelDueno, correoCrudo: string): Promise<void> {
  const correo = String(correoCrudo ?? "").trim().toLowerCase();
  await sql.begin(async (tx) => {
    const [fila] = await tx<{ id: string }>`
      select u.id from "user" u join superadministrador s on s.user_id = u.id
      where u.email = ${correo} limit 1`;
    if (!fila) {
      throw new SuperadminError("no_es_superadmin", `${correo || "(vacío)"} no es superadministrador`);
    }
    await tx`delete from two_factor where user_id = ${fila.id}`;
    await tx`update "user" set two_factor_enabled = false where id = ${fila.id}`;
    await tx`update superadministrador set totp_activado_en = null where user_id = ${fila.id}`;
    await tx`delete from session where user_id = ${fila.id}`;
  });
}
