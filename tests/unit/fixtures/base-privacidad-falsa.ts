import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { schema } from "@/lib/db";

/**
 * 068 — Una base simulada para `privacy_profile` y `organization`. Un WHERE se
 * convierte a SQL de verdad (PgDialect) y solo devuelve las filas cuya
 * organización viaja en sus parámetros: una consulta sin la organización
 * devuelve lo de todos, en el orden en que se guardaron.
 */
export type FilaPerfil = typeof schema.privacyProfile.$inferSelect;

export function baseFalsa(inicial: {
  organizaciones: string[];
  perfiles?: FilaPerfil[];
}) {
  const perfiles = [...(inicial.perfiles ?? [])];
  const consultas: { sql: string; params: unknown[] }[] = [];
  const escritos: Record<string, unknown>[] = [];

  function filas(tabla: unknown, condicion?: SQL) {
    const todas: { organizationId?: string; id?: string }[] =
      tabla === schema.organization
        ? inicial.organizaciones.map((id) => ({ id }))
        : perfiles;
    if (!condicion) return todas;
    const query = new PgDialect().sqlToQuery(condicion);
    consultas.push(query);
    return todas.filter((f) =>
      query.params.includes(
        tabla === schema.organization ? f.id : f.organizationId
      )
    );
  }

  const db = {
    select: () => ({
      from: (tabla: unknown) => ({
        where: (condicion: SQL) => ({
          limit: () => Promise.resolve(filas(tabla, condicion)),
        }),
        limit: () => Promise.resolve(filas(tabla)),
      }),
    }),
    insert: (tabla: unknown) => ({
      values: (valores: Record<string, unknown>) => ({
        onConflictDoUpdate: () => {
          if (tabla !== schema.privacyProfile) throw new Error("tabla inesperada");
          escritos.push(valores);
          const i = perfiles.findIndex(
            (p) => p.organizationId === valores.organizationId
          );
          // Como Postgres: al insertar, los defaults de la columna; al
          // reemplazar, se queda lo que el `set` no trae (072: retencion_dias).
          const fila = {
            retencionDias: 90,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...(i >= 0 ? perfiles[i] : {}),
            ...valores,
          } as FilaPerfil;
          if (i >= 0) perfiles[i] = { ...fila, id: perfiles[i]!.id };
          else perfiles.push(fila);
          return Promise.resolve();
        },
      }),
    }),
  };

  return { db, perfiles, consultas, escritos };
}
