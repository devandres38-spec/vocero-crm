/**
 * 075 (respuesta 3 de Andres) — El usuario de la app, creado por migrate.mjs.
 *
 * La app se conecta con `DATABASE_URL`; las migraciones, con
 * `DATABASE_MIGRATIONS_URL` (el dueño de las tablas). Después de migrar, el
 * dueño asegura que el usuario de `DATABASE_URL` exista, con `LOGIN`, sin
 * `SUPERUSER` ni `BYPASSRLS`, miembro de `vocero_app` y con la contraseña de
 * esa misma URL (del entorno del servidor, nunca del repo).
 *
 * Nunca se imprime la contraseña ni la URL. Si el usuario de `DATABASE_URL` es
 * un rol con privilegios (superusuario, BYPASSRLS o dueño de tablas), no se
 * toca: el arranque de la app lo rechazará en producción con su motivo.
 */

/** Nombres de rol que se pueden escribir sin comillas raras. */
const NOMBRE_DE_ROL = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Qué hacer con las dos URLs. `null`: nada (falta una, o son el mismo usuario,
 * como en el desarrollo de siempre).
 */
export function planUsuarioApp(appUrl, migracionesUrl) {
  if (!appUrl || !migracionesUrl) return null;
  let app;
  let mig;
  try {
    app = new URL(appUrl);
    mig = new URL(migracionesUrl);
  } catch {
    throw new Error("DATABASE_URL o DATABASE_MIGRATIONS_URL no es una URL válida");
  }
  const usuario = decodeURIComponent(app.username);
  const clave = decodeURIComponent(app.password);
  if (usuario === decodeURIComponent(mig.username)) return null;
  if (!NOMBRE_DE_ROL.test(usuario)) {
    throw new Error(
      "El usuario de DATABASE_URL debe ser minúsculas, números o guion bajo (empieza por letra)"
    );
  }
  if (clave.length < 12) {
    throw new Error("La contraseña del usuario de DATABASE_URL debe tener al menos 12 caracteres");
  }
  return { usuario, clave };
}

/** Un literal SQL entre comillas simples (`standard_conforming_strings` está activo desde Postgres 9.1). */
export function literal(valor) {
  return `'${String(valor).replace(/'/g, "''")}'`;
}

/**
 * Las sentencias, según lo que ya hay. `estado`: `null` si el rol no existe;
 * si existe, `{ privilegiado }` (superusuario, BYPASSRLS o dueño de tablas).
 */
export function sentenciasUsuarioApp({ usuario, clave }, estado) {
  const rol = `"${usuario}"`;
  if (estado === null) {
    return [
      `CREATE ROLE ${rol} LOGIN PASSWORD ${literal(clave)} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
      `GRANT vocero_app TO ${rol}`,
    ];
  }
  if (estado.privilegiado) return [];
  return [
    `ALTER ROLE ${rol} LOGIN PASSWORD ${literal(clave)} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    `GRANT vocero_app TO ${rol}`,
  ];
}

/** Lo que hay del rol: `null` si no existe. */
export async function estadoDelRol(sql, usuario) {
  const [fila] = await sql`
    select r.rolsuper or r.rolbypassrls or exists (
      select 1 from pg_tables t where t.schemaname = 'public' and t.tableowner = r.rolname
    ) as privilegiado
    from pg_roles r where r.rolname = ${usuario}`;
  return fila ? { privilegiado: fila.privilegiado === true } : null;
}

/** Asegura el usuario de la app. Devuelve un mensaje para el registro, sin secretos. */
export async function asegurarUsuarioApp(sql, appUrl, migracionesUrl) {
  const plan = planUsuarioApp(appUrl, migracionesUrl);
  if (!plan) return "usuario de la app: el mismo de las migraciones (sin separar)";
  const estado = await estadoDelRol(sql, plan.usuario);
  if (estado?.privilegiado) {
    return `usuario de la app ${plan.usuario}: tiene privilegios, no se toca (la app no arrancará en producción)`;
  }
  for (const sentencia of sentenciasUsuarioApp(plan, estado)) await sql.unsafe(sentencia);
  return `usuario de la app ${plan.usuario}: ${estado === null ? "creado" : "al día"}, miembro de vocero_app`;
}
