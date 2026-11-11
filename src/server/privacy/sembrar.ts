import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { perfilPrivacidadSchema } from "./perfil";
import {
  adjuntosPorDefecto,
  guardarPerfil,
  RETENCION_MAXIMA,
  RETENCION_MINIMA,
  RETENCION_POR_DEFECTO,
  retencionValida,
} from "./repositorio";

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
      /** 070 (D1): si se guardan los archivos de los pacientes. */
      adjuntos: boolean;
      /** 072 (D1): los días de retención que quedaron guardados. */
      retencionDias: number;
    }
  | { ok: false; error: string };

export async function sembrarPerfil(
  db: Db,
  entrada: {
    organizationId: string;
    contenido: string;
    sinFiltroSalud: boolean;
    /** 070 (D1): fuerza los adjuntos; sin él, el valor por defecto del perfil. */
    adjuntos?: boolean;
    /** 072 (D1): días de retención; sin él, 90 o los que ya tenía. */
    retencionDias?: number;
  }
): Promise<ResultadoSembrar> {
  if (entrada.retencionDias !== undefined && !retencionValida(entrada.retencionDias)) {
    return {
      ok: false,
      error: `--retencion debe ser un número entero de días entre ${RETENCION_MINIMA} y ${RETENCION_MAXIMA}.`,
    };
  }
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

  const adjuntos = entrada.adjuntos ?? adjuntosPorDefecto(perfil);
  const { huellaAnterior } = await guardarPerfil(db, entrada.organizationId, perfil, {
    adjuntos,
    ...(entrada.retencionDias === undefined
      ? {}
      : { retencionDias: entrada.retencionDias }),
  });
  const [guardado] = await db
    .select({ retencionDias: schema.privacyProfile.retencionDias })
    .from(schema.privacyProfile)
    .where(eq(schema.privacyProfile.organizationId, entrada.organizationId))
    .limit(1);
  return {
    ok: true,
    perfil: perfil.perfil,
    versionPerfil: perfil.versionPerfil,
    pais: perfil.pais,
    conSalud: perfil.sensible !== null,
    huella: perfil.huella,
    huellaAnterior,
    adjuntos,
    retencionDias: guardado?.retencionDias ?? RETENCION_POR_DEFECTO,
  };
}
