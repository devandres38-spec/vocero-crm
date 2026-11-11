/**
 * Migraciones al ARRANQUE del contenedor (no en pre-deploy: el pre-deploy de
 * plataformas como Coolify corre en el contenedor viejo). Se bundlea con
 * esbuild dentro de la imagen y corre antes de `node server.js`.
 *
 * 075 — Con `DATABASE_MIGRATIONS_URL` (el dueño de las tablas) migra con ella
 * y después asegura el usuario de la app de `DATABASE_URL`, sin privilegios y
 * miembro de `vocero_app` (scripts/lib/usuario-app.mjs). Sin ella, todo con
 * `DATABASE_URL`, como antes. Nunca imprime URLs ni contraseñas.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asegurarUsuarioApp } from "./lib/usuario-app.mjs";

const appUrl = process.env.DATABASE_URL;
const url = process.env.DATABASE_MIGRATIONS_URL || appUrl;
if (!url) {
  console.error("[migrate] DATABASE_URL no está definida");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? path.join(here, "drizzle");

/** El mensaje de un error, sin la URL ni la contraseña si vinieran dentro. */
function sinSecretos(err) {
  let msg = err instanceof Error ? err.message : String(err);
  for (const u of [url, appUrl]) {
    if (!u) continue;
    msg = msg.replaceAll(u, "[oculto]");
    try {
      const clave = new URL(u).password;
      if (clave) msg = msg.replaceAll(clave, "[oculto]").replaceAll(decodeURIComponent(clave), "[oculto]");
    } catch {}
  }
  return msg;
}

const maxAttempts = 15;
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  // TimeZone UTC: invariante de tiempo del proyecto (ver src/lib/db/index.ts).
  const sql = postgres(url, {
    max: 1,
    onnotice: () => {},
    connection: { TimeZone: "UTC" },
  });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
    console.log("[migrate] migraciones aplicadas");
    console.log(`[migrate] ${await asegurarUsuarioApp(sql, appUrl, process.env.DATABASE_MIGRATIONS_URL)}`);
    await sql.end();
    process.exit(0);
  } catch (err) {
    await sql.end().catch(() => {});
    if (attempt === maxAttempts) {
      console.error("[migrate] falló tras varios intentos:", sinSecretos(err));
      process.exit(1);
    }
    console.log(
      `[migrate] BD no lista (intento ${attempt}/${maxAttempts}), reintento en 2s…`
    );
    await new Promise((r) => setTimeout(r, 2000));
  }
}
