import type { Sql } from "postgres";

/**
 * 075 (D2 de la spec) — ¿Puede el usuario de la app saltarse el RLS? Lo hacen
 * el superusuario, quien tiene BYPASSRLS y el dueño de las tablas. Y aunque
 * no pueda, una tabla de negocio sin RLS lo deja todo abierto. Como
 * `rlsBypassReasons` del cerebro. Devuelve los motivos; vacío si es seguro.
 *
 * Lee solo el catálogo (sin RLS), con la conexión sin envoltorio.
 */
export async function motivosParaNoArrancar(sql: Sql): Promise<string[]> {
  const [fila] = await sql<
    {
      rolsuper: boolean;
      rolbypassrls: boolean;
      dueno: boolean;
      hereda_panel: boolean;
      sin_rls: string[];
    }[]
  >`
    select r.rolsuper, r.rolbypassrls,
      -- 076: la app entra al rol del panel con SET ROLE, pero no debe heredar
      -- sus permisos (si no, cualquier negocio podría leer los agregados).
      case when exists (select 1 from pg_roles p where p.rolname = 'vocero_panel')
        then pg_has_role(current_user, 'vocero_panel', 'USAGE') else false end as hereda_panel,
      exists (
        select 1 from pg_tables t
        where t.schemaname = 'public' and t.tableowner = current_user
      ) as dueno,
      (
        select coalesce(array_agg(c.relname::text order by c.relname), '{}')
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
          and (
            c.relname = 'organization'
            or (c.relname <> 'session' and exists (
              select 1 from pg_attribute a
              where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
            ))
          )
      ) as sin_rls
    from pg_roles r where r.rolname = current_user`;
  if (!fila) return ["no se pudo leer el rol de la conexión"];
  return [
    ...(fila.rolsuper ? ["es superusuario"] : []),
    ...(fila.rolbypassrls ? ["tiene BYPASSRLS"] : []),
    ...(fila.dueno ? ["es dueño de las tablas"] : []),
    ...(fila.hereda_panel ? ["hereda los permisos de vocero_panel"] : []),
    ...(fila.sin_rls.length > 0 ? [`tablas de negocio sin RLS: ${fila.sin_rls.join(", ")}`] : []),
  ];
}

/** En producción, un usuario inseguro (o no poder revisarlo) no arranca; fuera de ella, se avisa. */
export function decisionDeArranque(
  motivos: readonly string[] | "sin_revisar",
  nodeEnv: string | undefined
): "arrancar" | "avisar" | "no_arrancar" {
  const inseguro = motivos === "sin_revisar" || motivos.length > 0;
  if (!inseguro) return "arrancar";
  return nodeEnv === "production" ? "no_arrancar" : "avisar";
}

export const ARREGLO_RLS =
  "Conecta la app con un usuario sin privilegios (DATABASE_URL) y deja el dueño de las tablas en " +
  "DATABASE_MIGRATIONS_URL: migrate.mjs crea ese usuario al arrancar (spec 075).";
