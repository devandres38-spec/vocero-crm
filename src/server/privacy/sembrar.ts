import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { perfilPrivacidadSchema } from "./perfil";
import { guardarPerfil } from "./repositorio";

/**
 * 068 — Registrar el perfil de privacidad de un negocio (D2, D4, D5). Lo usa
 * `pnpm privacidad:sembrar`, que solo corre Andres. Cualquier rechazo deja la
 * base como estaba. Ni el resultado ni los errores llevan los términos.
 */

type Db = ReturnType<typeof getDb>;

export type ResultadoSembrar =
  | {
      ok: true;
      perfil: string;
      versionPerfil: number;
      pais: string;
      conSalud: boolean;
      huella: string;
      huellaAnterior: string | null;
    }
  | { ok: false; error: string };

export async function sembrarPerfil(
  db: Db,
  entrada: { organizationId: string; contenido: string; sinFiltroSalud: boolean }
): Promise<ResultadoSembrar> {
  let crudo: unknown;
  try {
    crudo = JSON.parse(entrada.contenido);
  } catch {
    return { ok: false, error: "El archivo no es JSON." };
  }

  const parsed = perfilPrivacidadSchema.safeParse(crudo);
  if (!parsed.success) {
    // Solo los campos y el motivo: los mensajes de zod no repiten los valores.
    const problemas = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`
    );
    return {
      ok: false,
      error: `El perfil no cumple el contrato (068):\n${problemas.join("\n")}`,
    };
  }
  const perfil = parsed.data;

  if (perfil.sensible === null && !entrada.sinFiltroSalud) {
    return {
      ok: false,
      error:
        "Este perfil apaga el filtro de salud. Solo se registra con --sin-filtro-salud, después de revisarlo con el abogado.",
    };
  }

  // Es un comando de mantenimiento, fuera de todo negocio: la organización
  // es justo lo que se está comprobando.
  const [organizacion] = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, entrada.organizationId))
    .limit(1);
  if (!organizacion) {
    return {
      ok: false,
      error: `No existe la organización ${entrada.organizationId}.`,
    };
  }

  const { huellaAnterior } = await guardarPerfil(db, entrada.organizationId, perfil);
  return {
    ok: true,
    perfil: perfil.perfil,
    versionPerfil: perfil.versionPerfil,
    pais: perfil.pais,
    conSalud: perfil.sensible !== null,
    huella: perfil.huella,
    huellaAnterior,
  };
}
